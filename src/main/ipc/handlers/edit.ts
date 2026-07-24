import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getIssueByKey, updateIssueFields, updateIssueStatus } from '../../db/repos/issue'
import { adfToText, textToAdf } from '../../jira/adf'
import { JiraHttpError } from '../../jira/http'
import { mapEditMeta } from '../../issues/editMeta'
import { markdownToAdf } from '../../issues/markdownToAdf'
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

  handle('issues:updateText', async ({ key, summary, descriptionMarkdown }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()

    const fields: Record<string, unknown> = {
      ...(summary && { summary }),
      ...(descriptionMarkdown !== undefined && { description: markdownToAdf(descriptionMarkdown) })
    }
    if (Object.keys(fields).length === 0) {
      throw new AppError('VALIDATION', 'Nada para atualizar')
    }

    try {
      await client.updateIssue(issueKey, fields)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('UPDATE_FAILED', 'O Jira recusou a edição: ' + parseCreateError(err))
      }
      throw err
    }

    // cache local: description_text guarda o markdown cru como texto
    updateIssueFields(ctx.db, workspace.id, issueKey, {
      summary,
      descriptionText: descriptionMarkdown
    })
    void ctx.scheduler?.trigger({})

    return { ok: true as const }
  })

  handle('worklog:list', async ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()

    const raw = await client.listWorklogs(issueKey)
    const worklogs = raw.map((w) => {
      const comment = adfToText(w.comment)
      return {
        id: w.id,
        authorName: w.author?.displayName ?? null,
        authorAccountId: w.author?.accountId ?? null,
        isMine: w.author?.accountId === workspace.account_id,
        started: w.started,
        timeSpent: w.timeSpent,
        timeSpentSeconds: w.timeSpentSeconds,
        comment: comment === '' ? null : comment
      }
    })

    const t = await client
      .issueTimeTracking(issueKey)
      .catch(() => ({ timeSpent: null, originalEstimate: null }))

    return { worklogs, totalTimeSpent: t.timeSpent }
  })

  handle('worklog:update', async ({ key, worklogId, timeSpent, comment }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()

    const trimmed = comment?.trim()
    try {
      await client.updateWorklog(
        issueKey,
        worklogId,
        timeSpent,
        trimmed ? textToAdf(trimmed) : undefined
      )
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

  handle('worklog:delete', async ({ key, worklogId }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()

    try {
      await client.deleteWorklog(issueKey, worklogId)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('WORKLOG_FAILED', 'O Jira recusou a exclusão: ' + parseCreateError(err))
      }
      throw err
    }

    const t = await client
      .issueTimeTracking(issueKey)
      .catch(() => ({ timeSpent: null, originalEstimate: null }))
    return { ok: true as const, totalTimeSpent: t.timeSpent }
  })

  handle('issues:linkTypes', async () => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const types = await client.listIssueLinkTypes()
    return { types }
  })

  handle('issues:linkCreate', async ({ fromKey, toKey, typeName, direction }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const from = fromKey.trim().toUpperCase()
    const to = toKey.trim().toUpperCase()

    // direção congelada: 'outward' → fromKey é o lado outward (ex. 'blocks' toKey)
    const outwardKey = direction === 'outward' ? from : to
    const inwardKey = direction === 'outward' ? to : from

    try {
      await client.createIssueLink(typeName, inwardKey, outwardKey)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('LINK_FAILED', 'O Jira recusou o vínculo: ' + parseCreateError(err))
      }
      throw err
    }

    return { ok: true as const }
  })
}
