import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { JiraHttp } from '../../jira/http'
import { JiraClient, discoverCustomFields } from '../../jira/client'
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceRow,
  setWorkspaceFields
} from '../../db/repos/workspace'
import { deleteCredentials, encryptionAvailable, storeCredential } from '../../security/credentials'

function normalizeSiteUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) url = `https://${url}`
  return url
}

export function registerAuthHandlers(ctx: AppContext): void {
  handle('auth:connect', async ({ siteUrl, email, apiToken }) => {
    if (!encryptionAvailable()) {
      throw new AppError(
        'NO_ENCRYPTION',
        'Criptografia do sistema indisponível — não é possível salvar o token com segurança'
      )
    }
    const normalized = normalizeSiteUrl(siteUrl)

    // valida credenciais antes de persistir qualquer coisa
    const http = new JiraHttp({ siteUrl: normalized, email, apiToken })
    const client = new JiraClient(http)
    const myself = await client.myself()
    const fields = discoverCustomFields(await client.listFields())

    // workspace único: reconectar substitui o anterior (mantém o cache de dados
    // apenas se for a mesma conta no mesmo site)
    const existing = getWorkspaceRow(ctx.db)
    if (existing && (existing.site_url !== normalized || existing.account_id !== myself.accountId)) {
      deleteWorkspace(ctx.db, existing.id)
    }

    let workspace = getWorkspace(ctx.db)
    if (!workspace) {
      workspace = createWorkspace(ctx.db, {
        siteUrl: normalized,
        email,
        accountId: myself.accountId,
        displayName: myself.displayName ?? null,
        timeZone: myself.timeZone ?? null
      })
    }
    setWorkspaceFields(ctx.db, workspace.id, {
      storyPointsFieldId: fields.storyPointsFieldId,
      sprintFieldId: fields.sprintFieldId
    })
    deleteCredentials(ctx.db, workspace.id)
    storeCredential(ctx.db, workspace.id, 'jira_api_token', apiToken)
    ctx.invalidateClient()

    return { workspace }
  })

  handle('auth:status', () => {
    const workspace = getWorkspace(ctx.db)
    return { connected: workspace !== null && ctx.getClient() !== null, workspace }
  })

  handle('auth:disconnect', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (workspace) {
      deleteCredentials(ctx.db, workspace.id)
      deleteWorkspace(ctx.db, workspace.id)
    }
    ctx.invalidateClient()
    return { ok: true as const }
  })
}
