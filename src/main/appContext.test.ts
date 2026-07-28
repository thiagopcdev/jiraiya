import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrations'
import { storeCredential } from './security/credentials'

vi.mock('electron', async () => (await import('./testing/electronMock')).createElectronMock())

const { AppContext } = await import('./appContext')

let db: Database.Database

function insertWorkspace(): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
  ).run()
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

describe('AppContext.push', () => {
  it('envia pelo webContents da janela principal', () => {
    const send = vi.fn()
    const ctx = new AppContext(db)
    ctx.mainWindow = { webContents: { send } } as unknown as typeof ctx.mainWindow

    ctx.push('push:queue-changed', { pending: 2, failed: 0 })

    expect(send).toHaveBeenCalledWith('push:queue-changed', { pending: 2, failed: 0 })
  })

  it('sem janela não lança (app em background / janela fechada)', () => {
    const ctx = new AppContext(db)

    expect(() => ctx.push('push:queue-changed', { pending: 0, failed: 0 })).not.toThrow()
  })
})

describe('AppContext.getClient', () => {
  it('sem workspace devolve null', () => {
    expect(new AppContext(db).getClient()).toBeNull()
  })

  it('workspace sem token do Jira devolve null', () => {
    insertWorkspace()

    expect(new AppContext(db).getClient()).toBeNull()
  })

  it('com workspace e token monta o client e o mantém em cache', () => {
    insertWorkspace()
    storeCredential(db, 1, 'jira_api_token', 'tk')
    const ctx = new AppContext(db)

    const client = ctx.getClient()

    expect(client).not.toBeNull()
    expect(ctx.getClient()).toBe(client)
  })

  it('invalidateClient força reconstrução com a credencial nova', () => {
    insertWorkspace()
    storeCredential(db, 1, 'jira_api_token', 'tk')
    const ctx = new AppContext(db)
    const first = ctx.getClient()

    ctx.invalidateClient()
    const second = ctx.getClient()

    expect(second).not.toBe(first)
    expect(second).not.toBeNull()
  })

  it('depois de apagar as credenciais e invalidar, volta a null', () => {
    insertWorkspace()
    storeCredential(db, 1, 'jira_api_token', 'tk')
    const ctx = new AppContext(db)
    ctx.getClient()

    db.prepare('DELETE FROM integration_credential').run()
    ctx.invalidateClient()

    expect(ctx.getClient()).toBeNull()
  })

  it('erro de auth do http dispara push:auth-invalid pela janela', async () => {
    insertWorkspace()
    storeCredential(db, 1, 'jira_api_token', 'tk')
    const send = vi.fn()
    const ctx = new AppContext(db)
    ctx.mainWindow = { webContents: { send } } as unknown as typeof ctx.mainWindow
    const client = ctx.getClient()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    )

    await expect(client?.myself()).rejects.toThrow('Credenciais do Jira inválidas ou expiradas')
    expect(send).toHaveBeenCalledWith('push:auth-invalid', {})

    vi.unstubAllGlobals()
  })

  it('scheduler começa nulo (é ligado no boot)', () => {
    expect(new AppContext(db).scheduler).toBeNull()
  })
})
