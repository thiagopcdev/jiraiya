import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { clearCommandLog, listCommandLog, logCommand } from './commandLog'

describe('repo de commandLog', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  it('logCommand insere e listCommandLog devolve os campos mapeados', () => {
    logCommand(db, {
      kind: 'cli',
      provider: 'claude',
      feature: 'summaries',
      command: 'claude -p oi',
      durationMs: 120,
      ok: true,
      error: null
    })

    const list = listCommandLog(db)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      kind: 'cli',
      provider: 'claude',
      feature: 'summaries',
      command: 'claude -p oi',
      durationMs: 120,
      ok: true,
      error: null
    })
    expect(typeof list[0].ts).toBe('string')
    expect(new Date(list[0].ts).toString()).not.toBe('Invalid Date')
  })

  it('listCommandLog devolve mais recente primeiro (id DESC)', () => {
    logCommand(db, {
      kind: 'http',
      provider: 'openrouter',
      feature: null,
      command: 'POST /x',
      durationMs: 10,
      ok: true,
      error: null
    })
    logCommand(db, {
      kind: 'http',
      provider: 'openrouter',
      feature: null,
      command: 'POST /y',
      durationMs: 20,
      ok: false,
      error: 'timeout'
    })

    const list = listCommandLog(db)
    expect(list.map((e) => e.command)).toEqual(['POST /y', 'POST /x'])
    expect(list[0].ok).toBe(false)
    expect(list[0].error).toBe('timeout')
  })

  it('limit funciona: insere 5, lista com limit 2 devolve as 2 mais recentes', () => {
    for (let i = 0; i < 5; i++) {
      logCommand(db, {
        kind: 'cli',
        provider: 'claude',
        feature: null,
        command: `cmd-${i}`,
        durationMs: null,
        ok: true,
        error: null
      })
    }

    const list = listCommandLog(db, 2)
    expect(list).toHaveLength(2)
    expect(list.map((e) => e.command)).toEqual(['cmd-4', 'cmd-3'])
  })

  it('cap: inserir 510 mantém só 500, as 10 primeiras inseridas somem', () => {
    for (let i = 0; i < 510; i++) {
      logCommand(db, {
        kind: 'cli',
        provider: 'claude',
        feature: null,
        command: `cmd-${i}`,
        durationMs: null,
        ok: true,
        error: null
      })
    }

    const list = listCommandLog(db, 600)
    expect(list).toHaveLength(500)
    for (let i = 0; i < 10; i++) {
      expect(list.some((e) => e.command === `cmd-${i}`)).toBe(false)
    }
  })

  it('clearCommandLog zera a tabela', () => {
    logCommand(db, {
      kind: 'cli',
      provider: 'claude',
      feature: null,
      command: 'cmd',
      durationMs: null,
      ok: true,
      error: null
    })
    clearCommandLog(db)
    expect(listCommandLog(db)).toEqual([])
  })
})
