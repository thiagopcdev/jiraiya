import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'

/** Permite simular o Keychain indisponível sem tocar no mock compartilhado. */
const encryption = vi.hoisted(() => ({ available: true }))

vi.mock('electron', async () => {
  const base = (await import('../testing/electronMock')).createElectronMock()
  return {
    ...base,
    safeStorage: {
      isEncryptionAvailable: () => encryption.available,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
    }
  }
})

const { deleteCredentials, encryptionAvailable, getCredential, storeCredential } =
  await import('./credentials')

describe('credenciais (safeStorage + integration_credential)', () => {
  let db: Database.Database

  beforeEach(() => {
    encryption.available = true
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at)
       VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
    ).run()
  })

  it('encryptionAvailable reflete o safeStorage', () => {
    expect(encryptionAvailable()).toBe(true)
    encryption.available = false
    expect(encryptionAvailable()).toBe(false)
  })

  it('round-trip: store grava criptografado e get devolve o valor original', () => {
    storeCredential(db, 1, 'jira_api_token', 'token-secreto')

    expect(getCredential(db, 1, 'jira_api_token')).toBe('token-secreto')
    const row = db.prepare('SELECT encrypted_value FROM integration_credential').get() as {
      encrypted_value: Buffer
    }
    expect(row.encrypted_value.toString()).toBe('enc:token-secreto')
    expect(row.encrypted_value.toString()).not.toBe('token-secreto')
  })

  it('get devolve a credencial mais recente quando há várias do mesmo tipo', () => {
    storeCredential(db, 1, 'jira_api_token', 'antigo')
    storeCredential(db, 1, 'jira_api_token', 'novo')

    expect(getCredential(db, 1, 'jira_api_token')).toBe('novo')
  })

  it('get devolve null quando não há credencial do tipo', () => {
    storeCredential(db, 1, 'jira_api_token', 'x')

    expect(getCredential(db, 1, 'openrouter_api_key')).toBeNull()
    expect(getCredential(db, 99, 'jira_api_token')).toBeNull()
  })

  it('tipos diferentes convivem no mesmo workspace', () => {
    storeCredential(db, 1, 'jira_api_token', 'tk')
    storeCredential(db, 1, 'openrouter_api_key', 'sk')

    expect(getCredential(db, 1, 'jira_api_token')).toBe('tk')
    expect(getCredential(db, 1, 'openrouter_api_key')).toBe('sk')
  })

  it('sem criptografia disponível recusa gravar — nunca plaintext', () => {
    encryption.available = false

    expect(() => storeCredential(db, 1, 'jira_api_token', 'token')).toThrow(
      'Criptografia do sistema indisponível — credencial não será salva'
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM integration_credential').get()).toEqual({ n: 0 })
  })

  it('deleteCredentials apaga tudo do workspace', () => {
    storeCredential(db, 1, 'jira_api_token', 'tk')
    storeCredential(db, 1, 'openrouter_api_key', 'sk')

    deleteCredentials(db, 1)

    expect(getCredential(db, 1, 'jira_api_token')).toBeNull()
    expect(getCredential(db, 1, 'openrouter_api_key')).toBeNull()
  })
})
