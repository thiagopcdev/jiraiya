import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint } from '../../db/repos/catalog'
import { getPrefs } from '../../db/repos/misc'
import { queryTimeline } from '../../db/repos/activity'
import { queryIssues } from '../../queries/issues'
import { resolvePeriod, type Period } from '@shared/periods'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
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

  handle('sprint:active', () => {
    const workspace = requireWorkspace(ctx)
    return { sprint: getActiveSprint(ctx.db, workspace.id) }
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
