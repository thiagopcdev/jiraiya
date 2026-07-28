import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

/** userData isolado: o openDb sem argumento grava jiraiya.db lá. */
const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const base = (await import('../testing/electronMock')).createElectronMock()
  return { ...base, app: { ...(base.app as object), getPath: () => userData.dir } }
})

userData.dir = mkdtempSync(join(tmpdir(), 'jiraiya-db-'))

const { closeDb, getDb, openDb } = await import('./index')

afterEach(() => {
  closeDb()
})

afterAll(() => {
  rmSync(userData.dir, { recursive: true, force: true })
})

describe('openDb / getDb / closeDb', () => {
  it('abre no caminho informado, roda as migrations e liga os pragmas', () => {
    const path = join(userData.dir, 'explicito.db')

    const db = openDb(path)

    expect(existsSync(path)).toBe(true)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    // migrations rodaram: tabelas do schema existem
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='issue'`).get()
    ).toEqual({ name: 'issue' })
  })

  it('segunda chamada devolve a MESMA instância (singleton), ignorando o path', () => {
    const first = openDb(join(userData.dir, 'a.db'))
    const second = openDb(join(userData.dir, 'b.db'))

    expect(second).toBe(first)
    expect(existsSync(join(userData.dir, 'b.db'))).toBe(false)
  })

  it('sem path usa userData/jiraiya.db', () => {
    openDb()

    expect(existsSync(join(userData.dir, 'jiraiya.db'))).toBe(true)
  })

  it('getDb antes do openDb explica o que fazer', () => {
    expect(() => getDb()).toThrow('DB não inicializado — chame openDb() no boot')
  })

  it('getDb depois do openDb devolve a instância aberta', () => {
    const db = openDb(join(userData.dir, 'c.db'))

    expect(getDb()).toBe(db)
  })

  it('closeDb fecha e permite reabrir; é seguro chamar sem DB aberto', () => {
    const db = openDb(join(userData.dir, 'd.db'))
    closeDb()

    expect(() => db.prepare('SELECT 1').get()).toThrow()
    expect(() => closeDb()).not.toThrow()

    const reopened = openDb(join(userData.dir, 'd.db'))
    expect(reopened).not.toBe(db)
    expect(reopened.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 })
  })
})
