import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { dismissAlert, listActiveAlerts } from '../../db/repos/misc'
import { getWorkspaceRow } from '../../db/repos/workspace'

export function registerAlertHandlers(ctx: AppContext): void {
  handle('alerts:list', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) return { alerts: [] }
    return { alerts: listActiveAlerts(ctx.db, workspace.id) }
  })

  handle('alerts:dismiss', ({ id }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    dismissAlert(ctx.db, workspace.id, id)
    return { ok: true as const }
  })
}
