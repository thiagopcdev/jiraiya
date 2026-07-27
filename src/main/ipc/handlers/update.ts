import { shell } from 'electron'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { storeCredential } from '../../security/credentials'
import { checkForUpdate, downloadUpdate } from '../../update'

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

  handle('update:download', async () => {
    let path: string
    try {
      path = await downloadUpdate(ctx.db, (percent) =>
        ctx.push('push:update-progress', { percent })
      )
    } catch (err) {
      throw new AppError(
        'UPDATE_DOWNLOAD',
        err instanceof Error ? err.message : 'Falha ao baixar a atualização'
      )
    }
    // abre o instalador (DMG monta / .exe roda o setup); falha aqui não invalida o download
    await shell.openPath(path)
    return { ok: true as const, path }
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
