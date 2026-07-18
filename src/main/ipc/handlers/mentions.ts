import { handle } from '../registry'
import type { AppContext } from '../../appContext'
import { listMentions, markAllRead, unreadCount } from '../../db/repos/mentions'
import { getWorkspaceRow } from '../../db/repos/workspace'

export function registerMentionHandlers(ctx: AppContext): void {
  handle('mentions:list', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) return { mentions: [], unreadCount: 0 }
    return {
      mentions: listMentions(ctx.db, workspace.id),
      unreadCount: unreadCount(ctx.db, workspace.id)
    }
  })

  handle('mentions:markAllRead', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (workspace) markAllRead(ctx.db, workspace.id)
    return { ok: true as const }
  })
}
