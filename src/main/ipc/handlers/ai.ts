import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { clearCommandLog, listCommandLog } from '../../db/repos/commandLog'
import { getCredential, storeCredential } from '../../security/credentials'
import { aiStatus } from '../../ai/service'
import { listOpenRouterModels, validateOpenRouterKey } from '../../ai/providers/openrouter'

const CREDENTIAL_TYPE = 'openrouter_api_key'

/**
 * Remove apenas a chave do OpenRouter (não usa deleteCredentials, que apaga
 * TODAS as credenciais do workspace, inclusive o token do Jira).
 */
function deleteOpenRouterKey(db: AppContext['db'], workspaceId: number): void {
  db.prepare(`DELETE FROM integration_credential WHERE workspace_id = ? AND type = ?`).run(
    workspaceId,
    CREDENTIAL_TYPE
  )
}

export function registerAiHandlers(ctx: AppContext): void {
  handle('ai:status', () => aiStatus())

  handle('ai:openrouterModels', async ({ refresh }) => {
    const workspace = getWorkspaceRow(ctx.db)
    const key = workspace ? getCredential(ctx.db, workspace.id, CREDENTIAL_TYPE) : null
    if (!key) {
      throw new AppError('OPENROUTER_ERROR', 'Configure a chave do OpenRouter em Ajustes')
    }
    const models = await listOpenRouterModels(key, refresh)
    return { models }
  })

  handle('ai:setOpenRouterKey', async ({ key }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    const valid = await validateOpenRouterKey(key)
    if (!valid) {
      throw new AppError('OPENROUTER_ERROR', 'Chave inválida — o OpenRouter recusou a autenticação')
    }
    // segue o padrão do token do GitHub: remove a anterior e grava via safeStorage
    deleteOpenRouterKey(ctx.db, workspace.id)
    storeCredential(ctx.db, workspace.id, CREDENTIAL_TYPE, key)
    return { ok: true as const }
  })

  handle('ai:clearOpenRouterKey', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    deleteOpenRouterKey(ctx.db, workspace.id)
    return { ok: true as const }
  })

  handle('commandLog:list', () => ({ entries: listCommandLog(ctx.db) }))

  handle('commandLog:clear', () => {
    clearCommandLog(ctx.db)
    return { ok: true as const }
  })
}
