import { beforeEach, describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  encryption: true,
  myself: { accountId: 'me-1', displayName: 'Eu Mesmo', timeZone: 'America/Sao_Paulo' } as {
    accountId: string
    displayName?: string | null
    timeZone?: string | null
  },
  myselfError: null as Error | null
}))

vi.mock('electron', async () => {
  const base = (await import('../../testing/electronMock')).createElectronMock()
  const safeStorage = base.safeStorage as {
    encryptString: (s: string) => Buffer
    decryptString: (b: Buffer) => string
  }
  return {
    ...base,
    safeStorage: {
      ...safeStorage,
      isEncryptionAvailable: () => authState.encryption
    }
  }
})

vi.mock('../../jira/client', () => ({
  JiraClient: class {
    async myself(): Promise<unknown> {
      if (authState.myselfError) throw authState.myselfError
      return authState.myself
    }
    async listFields(): Promise<unknown[]> {
      return []
    }
  },
  discoverCustomFields: () => ({
    storyPointsFieldId: 'customfield_10016',
    sprintFieldId: 'customfield_10020',
    flaggedFieldId: null
  })
}))

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { JiraAuthError } = await import('../../jira/http')
const { getCredential } = await import('../../security/credentials')
const { registerAuthHandlers } = await import('./auth')

let t: ReturnType<typeof makeTestContext>

const CONNECT = { siteUrl: 'x.atlassian.net', email: 'e@x.com', apiToken: 'tok-123' }

beforeEach(() => {
  authState.encryption = true
  authState.myselfError = null
  authState.myself = { accountId: 'me-1', displayName: 'Eu Mesmo', timeZone: 'America/Sao_Paulo' }
  t = makeTestContext()
  registerAuthHandlers(t.ctx)
})

describe('auth:connect', () => {
  it('mesma conta e mesmo site: mantém o workspace, grava campos e token', async () => {
    const res = await invokeHandler('auth:connect', CONNECT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.workspace.siteUrl).toBe('https://x.atlassian.net')
    expect(res.data.workspace.accountId).toBe('me-1')

    const row = t.db
      .prepare('SELECT id, story_points_field_id, sprint_field_id, flagged_field_id FROM workspace')
      .get() as {
      id: number
      story_points_field_id: string
      sprint_field_id: string
      flagged_field_id: string
    }
    expect(row.id).toBe(1)
    expect(row.story_points_field_id).toBe('customfield_10016')
    // 'none' = procurado e ausente na instância
    expect(row.flagged_field_id).toBe('none')
    expect(getCredential(t.db, row.id, 'jira_api_token')).toBe('tok-123')
  })

  it('conta diferente substitui o workspace anterior', async () => {
    authState.myself = { accountId: 'outro-1', displayName: 'Outro' }
    const res = await invokeHandler('auth:connect', CONNECT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.workspace.accountId).toBe('outro-1')

    const rows = t.db.prepare('SELECT account_id FROM workspace').all() as Array<{
      account_id: string
    }>
    expect(rows).toEqual([{ account_id: 'outro-1' }])
  })

  it('site diferente também substitui o workspace', async () => {
    const res = await invokeHandler('auth:connect', {
      ...CONNECT,
      siteUrl: 'https://outro.atlassian.net/'
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.workspace.siteUrl).toBe('https://outro.atlassian.net')
  })

  it('sem criptografia do sistema → NO_ENCRYPTION antes de qualquer rede', async () => {
    authState.encryption = false
    const res = await invokeHandler('auth:connect', CONNECT)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NO_ENCRYPTION')
  })

  it('credencial recusada pelo Jira → JIRA_AUTH e nada é persistido', async () => {
    authState.myselfError = new JiraAuthError(401, 'token inválido')
    const res = await invokeHandler('auth:connect', CONNECT)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JIRA_AUTH')
    expect(getCredential(t.db, 1, 'jira_api_token')).toBeNull()
  })

  it('email inválido → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('auth:connect', { ...CONNECT, email: 'nao-email' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('auth:status', () => {
  it('workspace sem client → connected false', async () => {
    t.setClient(null)
    const res = await invokeHandler('auth:status', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.connected).toBe(false)
    expect(res.data.workspace?.accountId).toBe('me-1')
  })

  it('workspace com client → connected true', async () => {
    t.setClient({})
    const res = await invokeHandler('auth:status', {})
    expect(res.ok && res.data.connected).toBe(true)
  })

  it('sem workspace → connected false e workspace null', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('auth:status', {})
    expect(res.ok && res.data).toEqual({ connected: false, workspace: null })
  })
})

describe('auth:disconnect', () => {
  it('apaga workspace e credenciais', async () => {
    await invokeHandler('auth:connect', CONNECT)
    const res = await invokeHandler('auth:disconnect', {})
    expect(res.ok && res.data).toEqual({ ok: true })

    const rows = t.db.prepare('SELECT id FROM workspace').all()
    expect(rows).toEqual([])
    const creds = t.db.prepare('SELECT id FROM integration_credential').all()
    expect(creds).toEqual([])
  })

  it('sem workspace ainda responde ok', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('auth:disconnect', {})
    expect(res.ok && res.data).toEqual({ ok: true })
  })
})
