import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { Issue } from '@shared/domain'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { listFilters, saveFilter, deleteFilter } from '../../db/repos/filters'
import { mapIssue } from '../../sync/mapIssue'
import type { IssueUpsert } from '../../db/repos/issue'
import type { JiraIssue } from '../../jira/types'
import { JiraHttpError } from '../../jira/http'
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

/** Monta um DTO Issue a partir do upsert cru, sem tocar no banco. */
function upsertToIssue(u: IssueUpsert, siteUrl: string): Issue {
  return {
    jiraId: u.jiraId,
    key: u.key,
    projectKey: u.projectKey,
    summary: u.summary,
    descriptionText: u.descriptionText,
    issueType: u.issueType,
    status: u.status,
    statusCategory: (u.statusCategory as Issue['statusCategory']) ?? null,
    priority: u.priority,
    assigneeAccountId: u.assigneeAccountId,
    assigneeName: u.assigneeName,
    reporterAccountId: u.reporterAccountId,
    storyPoints: u.storyPoints,
    sprintJiraId: u.sprintJiraId,
    labels: u.labels,
    parentKey: u.parentKey,
    flagged: u.flagged,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    resolvedAt: u.resolvedAt,
    url: `${siteUrl.replace(/\/$/, '')}/browse/${u.key}`
  }
}

export function registerFilterHandlers(ctx: AppContext): void {
  handle('filters:list', () => {
    const workspace = requireWorkspace(ctx)
    return { filters: listFilters(ctx.db, workspace.id) }
  })

  handle('filters:save', ({ id, name, jql }) => {
    const workspace = requireWorkspace(ctx)
    const savedId = saveFilter(ctx.db, workspace.id, { id, name, jql })
    return { id: savedId }
  })

  handle('filters:delete', ({ id }) => {
    const workspace = requireWorkspace(ctx)
    deleteFilter(ctx.db, workspace.id, id)
    return { ok: true as const }
  })

  handle('filters:run', async ({ jql, limit }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const max = limit ?? 50
    const fieldIds = {
      storyPointsFieldId: workspace.story_points_field_id,
      sprintFieldId: workspace.sprint_field_id,
      flaggedFieldId: workspace.flagged_field_id === 'none' ? null : workspace.flagged_field_id
    }
    const compact = [
      fieldIds.storyPointsFieldId,
      fieldIds.sprintFieldId,
      fieldIds.flaggedFieldId
    ].filter((f): f is string => f !== null)

    const raw: JiraIssue[] = []
    try {
      await client.searchAll(jql, compact, (page: JiraIssue[]) => {
        raw.push(...page)
        // para na primeira página que exceder o limite (busca ao vivo enxuta)
        if (raw.length > max) throw new StopPaging()
      })
    } catch (err) {
      if (!(err instanceof StopPaging)) {
        if (err instanceof JiraHttpError && err.status === 400) {
          throw new AppError('JQL_INVALID', 'JQL inválida: ' + parseCreateError(err))
        }
        throw err
      }
    }

    const truncated = raw.length > max
    const issues = raw
      .slice(0, max)
      .map((r) => upsertToIssue(mapIssue(r, fieldIds), workspace.site_url))
    return { issues, truncated }
  })
}

/** Sinaliza que já acumulamos issues suficientes e o loop de páginas deve parar. */
class StopPaging extends Error {}
