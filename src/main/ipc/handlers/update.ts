import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { storeCredential } from '../../security/credentials'
import { checkForUpdate } from '../../update'

/**
 * Remove apenas o token do GitHub (não usa deleteCredentials, que apaga TODAS
 * as credenciais do workspace, inclusive o token do Jira).
 */
function deleteGithubToken(db: AppContext['db'], workspaceId: number): void {
  db.prepare(
    `DELETE FROM integration_credential WHERE workspace_id = ? AND type = 'github_token'`
  ).run(workspaceId)
}

export function registerUpdateHandlers(ctx: AppContext): void {
  handle('update:check', async () => {
    // force ignora cache — não há cache na v1, então sempre consulta ao vivo
    return checkForUpdate(ctx.db, {
      notify: false,
      push: (v) => ctx.push('push:update-available', v)
    })
  })

  handle('update:setToken', ({ token }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    // segue o padrão do token do Jira: remove o anterior e grava via safeStorage
    deleteGithubToken(ctx.db, workspace.id)
    if (token !== null) {
      storeCredential(ctx.db, workspace.id, 'github_token', token)
    }
    return { ok: true as const }
  })
}
