import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { getNote, setNote } from './notes'

function insertWorkspace(db: Database.Database, id: number, accountId: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, 'https://x.atlassian.net', 'e@x.com', @accountId, 'now')`
  ).run({ id, accountId })
}

describe('repo de notes (issue_note)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1, 'acc-1')
    insertWorkspace(db, 2, 'acc-2')
  })

  it('getNote sem linha existente devolve content e updatedAt null', () => {
    const note = getNote(db, 1, 'BT-1')
    expect(note).toEqual({ content: null, updatedAt: null })
  })

  it('setNote cria a nota; getNote devolve o content e um updatedAt não-nulo', () => {
    setNote(db, 1, 'BT-1', 'minha anotação privada')

    const note = getNote(db, 1, 'BT-1')
    expect(note.content).toBe('minha anotação privada')
    expect(note.updatedAt).not.toBeNull()
  })

  it('setNote de novo sobrescreve o conteúdo (UPSERT pela mesma chave)', () => {
    setNote(db, 1, 'BT-1', 'primeira versão')
    setNote(db, 1, 'BT-1', 'segunda versão')

    const note = getNote(db, 1, 'BT-1')
    expect(note.content).toBe('segunda versão')

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM issue_note WHERE workspace_id = 1 AND issue_key = ?')
      .get('BT-1') as { n: number }
    expect(count.n).toBe(1)
  })

  it('setNote com string vazia apaga a linha → getNote volta a null', () => {
    setNote(db, 1, 'BT-1', 'algo')
    setNote(db, 1, 'BT-1', '')

    expect(getNote(db, 1, 'BT-1')).toEqual({ content: null, updatedAt: null })
  })

  it('setNote com string só de espaços também apaga a linha', () => {
    setNote(db, 1, 'BT-1', 'algo')
    setNote(db, 1, 'BT-1', '   ')

    expect(getNote(db, 1, 'BT-1')).toEqual({ content: null, updatedAt: null })
  })

  it('notas são isoladas por workspace_id', () => {
    setNote(db, 1, 'BT-1', 'nota do workspace 1')
    setNote(db, 2, 'BT-1', 'nota do workspace 2')

    expect(getNote(db, 1, 'BT-1').content).toBe('nota do workspace 1')
    expect(getNote(db, 2, 'BT-1').content).toBe('nota do workspace 2')
  })
})
