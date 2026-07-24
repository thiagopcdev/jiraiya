import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { epicsOverview } from '../../queries/epics'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerEpicHandlers(ctx: AppContext): void {
  handle('epics:overview', () => {
    const workspace = requireWorkspace(ctx)
    return { epics: epicsOverview(ctx.db, workspace.id, workspace.site_url) }
  })
}
