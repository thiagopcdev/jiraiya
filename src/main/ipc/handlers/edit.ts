import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getIssueByKey, updateIssueFields, updateIssueStatus } from '../../db/repos/issue'
import { textToAdf } from '../../jira/adf'
import { JiraHttpError } from '../../jira/http'
import { mapEditMeta } from '../../issues/editMeta'
import { parseCreateError } from './create'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function requireClient(ctx: AppContext): NonNullable<ReturnType<typeof ctx.getClient>> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return client
}

/** Id do campo de story points, ou null se não configurado ('none' = usuário desativou). */
function storyPointsFieldId(workspace: ReturnType<typeof requireWorkspace>): string | null {
  const id = workspace.story_points_field_id
  return id && id !== 'none' ? id : null
}

export function registerEditHandlers(ctx: AppContext): void {
  handle('issues:editMeta', async ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    const [raw, tracking] = await Promise.all([
      client.issueEditMeta(issueKey),
      client.issueTimeTracking(issueKey)
    ])
    return mapEditMeta({
      raw,
      storyPointsFieldId: storyPointsFieldId(workspace),
      currentPriority: issue.priority,
      currentSeverity: null,
      timeSpent: tracking.timeSpent,
      originalEstimate: tracking.originalEstimate
    })
  })

  handle(
    'issues:update',
    async ({
      key,
      storyPoints,
      priorityId,
      priorityName,
      severity,
      originalEstimate,
      assigneeAccountId,
      assigneeName
    }) => {
      const workspace = requireWorkspace(ctx)
      const client = requireClient(ctx)
      const issueKey = key.trim().toUpperCase()
      const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
      if (!issue) {
        throw new AppError(
          'NOT_FOUND',
          'Card não encontrado localmente — sincronize ou confira a key'
        )
      }

      const spFieldId = storyPointsFieldId(workspace)
      const fields: Record<string, unknown> = {}
      if (storyPoints !== undefined && spFieldId) fields[spFieldId] = storyPoints
      if (priorityId) fields.priority = { id: priorityId }
      if (severity) fields[severity.fieldId] = { id: severity.optionId }
      if (originalEstimate) fields.timetracking = { originalEstimate }
      if (assigneeAccountId !== undefined) {
        fields.assignee = assigneeAccountId === null ? null : { id: assigneeAccountId }
      }

      if (Object.keys(fields).length === 0) {
        throw new AppError('NOTHING_TO_UPDATE', 'Nada para atualizar')
      }

      try {
        await client.updateIssue(issueKey, fields)
      } catch (err) {
        if (err instanceof JiraHttpError) {
          throw new AppError('UPDATE_FAILED', 'O Jira recusou a edição: ' + parseCreateError(err))
        }
        throw err
      }

      const patch: {
        storyPoints?: number | null
        priority?: string
        assigneeAccountId?: string | null
        assigneeName?: string | null
      } = {}
      if (storyPoints !== undefined && spFieldId) patch.storyPoints = storyPoints
      if (priorityName) patch.priority = priorityName
      if (assigneeAccountId !== undefined) patch.assigneeAccountId = assigneeAccountId
      if (assigneeName !== undefined) patch.assigneeName = assigneeName
      updateIssueFields(ctx.db, workspace.id, issueKey, patch)
      void ctx.scheduler?.trigger({})

      return { ok: true as const }
    }
  )

  handle('issues:transitions', async ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    const transitions = (await client.issueTransitions(issueKey)).map((t) => ({
      id: t.id,
      name: t.name,
      toStatusName: t.toStatusName,
      toCategoryKey: t.toCategoryKey
    }))
    return { transitions }
  })

  handle('issues:transition', async ({ key, transitionId }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }

    const transitions = await client.issueTransitions(issueKey)
    const picked = transitions.find((t) => t.id === transitionId)
    if (!picked) {
      throw new AppError('NO_TRANSITION', 'Transição inválida — recarregue o card')
    }

    try {
      await client.doTransition(issueKey, picked.id)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError(
          'TRANSITION_FAILED',
          'O Jira recusou a transição: ' + parseCreateError(err)
        )
      }
      throw err
    }

    updateIssueStatus(ctx.db, workspace.id, issueKey, picked.toStatusName, picked.toCategoryKey)
    void ctx.scheduler?.trigger({})
    return { newStatus: picked.toStatusName, newStatusCategory: picked.toCategoryKey }
  })

  handle('issues:assignable', async ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    const users = await client.assignableUsers(issueKey)
    return { users }
  })

  handle('issues:logWork', async ({ key, timeSpent, comment }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey)
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }

    const trimmed = comment?.trim()
    try {
      await client.addWorklog(issueKey, timeSpent, trimmed ? textToAdf(trimmed) : undefined)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('WORKLOG_FAILED', 'O Jira recusou o registro: ' + parseCreateError(err))
      }
      throw err
    }

    const t = await client
      .issueTimeTracking(issueKey)
      .catch(() => ({ timeSpent: null, originalEstimate: null }))
    return { ok: true as const, totalTimeSpent: t.timeSpent }
  })
}
