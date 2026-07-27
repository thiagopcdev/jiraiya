import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { listTemplates, saveTemplate, deleteTemplate } from '../../db/repos/templates'

function requireWorkspaceId(ctx: AppContext): number {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace.id
}

export function registerTemplateHandlers(ctx: AppContext): void {
  handle('templates:list', () => {
    const workspaceId = requireWorkspaceId(ctx)
    return { templates: listTemplates(ctx.db, workspaceId) }
  })

  handle('templates:save', ({ id, name, content }) => {
    const workspaceId = requireWorkspaceId(ctx)
    try {
      return { template: saveTemplate(ctx.db, workspaceId, { id, name, content }) }
    } catch (err) {
      throw new AppError(
        'TEMPLATE_NOT_FOUND',
        err instanceof Error ? err.message : 'Não foi possível salvar o template'
      )
    }
  })

  handle('templates:delete', ({ id }) => {
    const workspaceId = requireWorkspaceId(ctx)
    deleteTemplate(ctx.db, workspaceId, id)
    return { ok: true as const }
  })
}
