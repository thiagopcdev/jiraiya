import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { searchGlobal } from '../../queries/search'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerSearchHandlers(ctx: AppContext): void {
  handle('search:global', ({ query, limit }) => {
    const workspace = requireWorkspace(ctx)
    const results = searchGlobal(ctx.db, workspace.id, workspace.site_url, query, limit ?? 20)
    return { results }
  })
}
