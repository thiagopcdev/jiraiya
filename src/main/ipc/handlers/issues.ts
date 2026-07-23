import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint, listRecentSprints } from '../../db/repos/catalog'
import { getPrefs } from '../../db/repos/misc'
import { queryTimeline, listIssueActivities } from '../../db/repos/activity'
import { queryIssues, searchIssues } from '../../queries/issues'
import { buildLeadTime } from '../../queries/leadTime'
import { getIssueByKey, listChildIssues, rowToIssue } from '../../db/repos/issue'
import { mapIssueLinks } from '../../issues/links'
import { resolvePeriod, type Period } from '@shared/periods'
import type { SprintListItem } from '@shared/domain'

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

export function resolveWithSprint(
  ctx: AppContext,
  workspaceId: number,
  period: Period
): ReturnType<typeof resolvePeriod> {
  const sprint = period.type === 'sprint' ? getActiveSprint(ctx.db, workspaceId) : null
  return resolvePeriod(period, new Date(), sprint ?? undefined)
}

export function registerIssueHandlers(ctx: AppContext): void {
  handle('issues:query', ({ period, bucket }) => {
    const workspace = requireWorkspace(ctx)
    const range = resolveWithSprint(ctx, workspace.id, period)
    const prefs = getPrefs(ctx.db)
    const issues = queryIssues(
      {
        db: ctx.db,
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        siteUrl: workspace.site_url
      },
      {
        start: range.start,
        end: range.end,
        bucket: bucket ?? 'all',
        stalledDays: prefs.stalledDays
      }
    )
    return { issues }
  })

  handle('issues:get', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const row = getIssueByKey(ctx.db, workspace.id, key.trim().toUpperCase())
    return { issue: row ? rowToIssue(row, workspace.site_url) : null }
  })

  handle('issues:children', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const issues = listChildIssues(
      ctx.db,
      workspace.id,
      key.trim().toUpperCase(),
      workspace.site_url
    )
    return { issues }
  })

  handle('issues:links', async ({ key }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const links = mapIssueLinks(await client.issueLinks(key.trim().toUpperCase()))
    return { links }
  })

  handle('sprint:active', () => {
    const workspace = requireWorkspace(ctx)
    return { sprint: getActiveSprint(ctx.db, workspace.id) }
  })

  handle('issues:activity', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const activities = listIssueActivities(ctx.db, workspace.id, key.trim().toUpperCase())
    return { activities }
  })

  handle('issues:search', ({ query, limit }) => {
    const workspace = requireWorkspace(ctx)
    const issues = searchIssues(
      {
        db: ctx.db,
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        siteUrl: workspace.site_url
      },
      query,
      limit ?? 20
    )
    return { issues }
  })

  handle('sprint:list', ({ limit }) => {
    const workspace = requireWorkspace(ctx)
    const sprints: SprintListItem[] = listRecentSprints(ctx.db, workspace.id, limit ?? 12).map(
      (s) => ({
        jiraId: s.jiraId,
        name: s.name,
        state: s.state,
        startDate: s.startDate,
        endDate: s.completeDate ?? s.endDate
      })
    )
    return { sprints }
  })

  handle('stats:leadTime', ({ days }) => {
    const workspace = requireWorkspace(ctx)
    return buildLeadTime(
      { db: ctx.db, workspaceId: workspace.id, accountId: workspace.account_id },
      { days: days ?? 90 }
    )
  })

  handle('activity:timeline', ({ period, onlyMine, projectKey }) => {
    const workspace = requireWorkspace(ctx)
    const range = resolveWithSprint(ctx, workspace.id, period)
    const activities = queryTimeline(ctx.db, workspace.id, {
      start: range.start,
      end: range.end,
      actorAccountId: onlyMine === false ? undefined : workspace.account_id,
      projectKey
    })
    return { activities }
  })
}
