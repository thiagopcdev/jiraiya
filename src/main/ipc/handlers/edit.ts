import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getIssueByKey, updateIssueFields } from '../../db/repos/issue'
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
    async ({ key, storyPoints, priorityId, priorityName, severity, originalEstimate }) => {
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

      const patch: { storyPoints?: number | null; priority?: string } = {}
      if (storyPoints !== undefined && spFieldId) patch.storyPoints = storyPoints
      if (priorityName) patch.priority = priorityName
      updateIssueFields(ctx.db, workspace.id, issueKey, patch)
      void ctx.scheduler?.trigger({})

      return { ok: true as const }
    }
  )

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
