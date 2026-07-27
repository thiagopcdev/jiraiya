import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { sprintTrends } from '../../queries/trends'

export function registerTrendHandlers(ctx: AppContext): void {
  handle('team:trends', ({ sprintCount }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    return { sprints: sprintTrends(ctx.db, workspace.id, sprintCount ?? 6) }
  })
}
