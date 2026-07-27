import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { Issue } from '@shared/domain'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getIssueByKey, rowToIssue } from '../../db/repos/issue'
import { isWatching, listWatches, toggleWatch } from '../../db/repos/watch'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerWatchHandlers(ctx: AppContext): void {
  handle('watch:toggle', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    const watching = toggleWatch(ctx.db, workspace.id, key.trim().toUpperCase())
    return { watching }
  })

  handle('watch:status', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    return { watching: isWatching(ctx.db, workspace.id, key.trim().toUpperCase()) }
  })

  handle('watch:list', () => {
    const workspace = requireWorkspace(ctx)
    const issues: Issue[] = []
    for (const watch of listWatches(ctx.db, workspace.id)) {
      const row = getIssueByKey(ctx.db, workspace.id, watch.issueKey)
      // card seguido que ainda não veio no sync local — só omite da lista
      if (row) issues.push(rowToIssue(row, workspace.site_url))
    }
    return { issues }
  })
}
