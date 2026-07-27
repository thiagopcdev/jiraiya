import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getNote, setNote } from '../../db/repos/notes'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerNotesHandlers(ctx: AppContext): void {
  handle('notes:get', ({ key }) => {
    const workspace = requireWorkspace(ctx)
    return getNote(ctx.db, workspace.id, key.trim().toUpperCase())
  })

  handle('notes:set', ({ key, content }) => {
    const workspace = requireWorkspace(ctx)
    setNote(ctx.db, workspace.id, key.trim().toUpperCase(), content)
    return { ok: true as const }
  })
}
