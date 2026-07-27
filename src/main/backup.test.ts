import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrations'
import { getPrefs, setPrefs } from './db/repos/misc'
import { DEFAULT_PREFS } from '@shared/domain'
import { buildBackup, applyBackup } from './backup'

function insertWorkspace(db: Database.Database, id: number, accountId: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, 'https://x.atlassian.net', 'e@x.com', @accountId, 'now')`
  ).run({ id, accountId })
}

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  return db
}

const NOW = '2026-07-27T10:00:00.000Z'

describe('backup (buildBackup / applyBackup)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    insertWorkspace(db, 1, 'acc-1')
  })

  describe('buildBackup', () => {
    it('monta o objeto de backup com o formato esperado', () => {
      db.prepare(
        `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
         VALUES (1, 'BT-1', 'minha nota', '2026-07-20T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
         VALUES (1, 'BT-2', 'In Progress', '2026-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO jql_filter (workspace_id, name, jql, position, created_at)
         VALUES (1, 'Meus cards', 'assignee = currentUser()', 0, '2026-07-01T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO comment_template (workspace_id, name, content, position, created_at)
         VALUES (1, 'Aviso', 'Conteúdo do template', 0, '2026-07-01T00:00:00.000Z')`
      ).run()
      setPrefs(db, { stalledDays: 7 })

      const raw = buildBackup(db, { id: 1, site_url: 'https://acme.atlassian.net' }, NOW)

      expect(raw.app).toBe('jiraiya')
      expect(raw.backupVersion).toBe(1)
      expect(raw.exportedAt).toBe(NOW)
      expect(raw.siteUrl).toBe('https://acme.atlassian.net')
      expect(raw.prefs).toMatchObject({ stalledDays: 7 })
      expect(raw.notes).toEqual([
        { issueKey: 'BT-1', content: 'minha nota', updatedAt: '2026-07-20T00:00:00.000Z' }
      ])
      expect(raw.watches).toEqual(['BT-2'])
      expect(raw.filters).toEqual([
        { name: 'Meus cards', jql: 'assignee = currentUser()', position: 0 }
      ])
      expect(raw.templates).toEqual([
        { name: 'Aviso', content: 'Conteúdo do template', position: 0 }
      ])
    })
  })

  describe('round-trip build → apply', () => {
    it('popula ws1, exporta e importa num DB novo: contagens e dados batem', () => {
      db.prepare(
        `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
         VALUES (1, 'BT-1', 'conteúdo original', '2026-07-20T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
         VALUES (1, 'BT-2', 'In Progress', '2026-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO jql_filter (workspace_id, name, jql, position, created_at)
         VALUES (1, 'Meus cards', 'assignee = currentUser()', 0, '2026-07-01T00:00:00.000Z')`
      ).run()
      db.prepare(
        `INSERT INTO comment_template (workspace_id, name, content, position, created_at)
         VALUES (1, 'Aviso', 'Conteúdo do template', 0, '2026-07-01T00:00:00.000Z')`
      ).run()
      setPrefs(db, { stalledDays: 7 })

      const raw = buildBackup(db, { id: 1, site_url: 'https://acme.atlassian.net' }, NOW)

      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')

      const result = applyBackup(dest, 1, raw)

      expect(result).toEqual({ notes: 1, watches: 1, filters: 1, templates: 1, prefs: true })

      const note = dest
        .prepare('SELECT content FROM issue_note WHERE workspace_id = 1 AND issue_key = ?')
        .get('BT-1') as { content: string }
      expect(note.content).toBe('conteúdo original')

      expect(getPrefs(dest).stalledDays).toBe(7)
    })
  })

  describe('merge sem apagar dados existentes', () => {
    it('nota existente em OUTRA issue é mantida; nota do backup é adicionada', () => {
      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')
      dest
        .prepare(
          `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
           VALUES (1, 'BT-EXISTENTE', 'já tinha isso', '2026-07-15T00:00:00.000Z')`
        )
        .run()

      const raw = buildRawBackup({
        notes: [{ issueKey: 'BT-NOVA', content: 'vinda do backup', updatedAt: NOW }]
      })

      applyBackup(dest, 1, raw)

      const rows = dest
        .prepare(
          'SELECT issue_key, content FROM issue_note WHERE workspace_id = 1 ORDER BY issue_key'
        )
        .all() as Array<{ issue_key: string; content: string }>
      expect(rows).toHaveLength(2)
      expect(rows.find((r) => r.issue_key === 'BT-EXISTENTE')?.content).toBe('já tinha isso')
      expect(rows.find((r) => r.issue_key === 'BT-NOVA')?.content).toBe('vinda do backup')
    })
  })

  describe('upsert de nota existente', () => {
    it('nota na MESMA issue é sobrescrita pelo content do backup (continua 1 linha)', () => {
      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')
      dest
        .prepare(
          `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
           VALUES (1, 'BT-1', 'versão antiga', '2026-07-15T00:00:00.000Z')`
        )
        .run()

      const raw = buildRawBackup({
        notes: [{ issueKey: 'BT-1', content: 'versão nova do backup', updatedAt: NOW }]
      })

      applyBackup(dest, 1, raw)

      const rows = dest
        .prepare('SELECT content FROM issue_note WHERE workspace_id = 1 AND issue_key = ?')
        .all('BT-1') as Array<{ content: string }>
      expect(rows).toHaveLength(1)
      expect(rows[0].content).toBe('versão nova do backup')
    })
  })

  describe('filtro/template com name já existente', () => {
    it('filtro existente não duplica e não conta na contagem', () => {
      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')
      dest
        .prepare(
          `INSERT INTO jql_filter (workspace_id, name, jql, position, created_at)
           VALUES (1, 'Meus cards', 'assignee = currentUser()', 0, '2026-07-01T00:00:00.000Z')`
        )
        .run()

      const raw = buildRawBackup({
        filters: [{ name: 'Meus cards', jql: 'status = Done', position: 0 }]
      })

      const result = applyBackup(dest, 1, raw)

      expect(result.filters).toBe(0)
      const rows = dest
        .prepare('SELECT jql FROM jql_filter WHERE workspace_id = 1 AND name = ?')
        .all('Meus cards') as Array<{ jql: string }>
      expect(rows).toHaveLength(1)
      expect(rows[0].jql).toBe('assignee = currentUser()')
    })

    it('template existente não duplica e não conta na contagem', () => {
      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')
      dest
        .prepare(
          `INSERT INTO comment_template (workspace_id, name, content, position, created_at)
           VALUES (1, 'Aviso', 'conteúdo original', 0, '2026-07-01T00:00:00.000Z')`
        )
        .run()

      const raw = buildRawBackup({
        templates: [{ name: 'Aviso', content: 'conteúdo do backup', position: 0 }]
      })

      const result = applyBackup(dest, 1, raw)

      expect(result.templates).toBe(0)
      const rows = dest
        .prepare('SELECT content FROM comment_template WHERE workspace_id = 1 AND name = ?')
        .all('Aviso') as Array<{ content: string }>
      expect(rows).toHaveLength(1)
      expect(rows[0].content).toBe('conteúdo original')
    })
  })

  describe('watch já existente', () => {
    it('não duplica (INSERT OR IGNORE)', () => {
      const dest = makeDb()
      insertWorkspace(dest, 1, 'acc-dest')
      dest
        .prepare(
          `INSERT INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
           VALUES (1, 'BT-2', 'In Progress', '2026-07-19T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`
        )
        .run()

      const raw = buildRawBackup({ watches: ['BT-2'] })

      applyBackup(dest, 1, raw)

      const rows = dest
        .prepare('SELECT id FROM watch WHERE workspace_id = 1 AND issue_key = ?')
        .all('BT-2')
      expect(rows).toHaveLength(1)
    })
  })

  describe('raw inválido', () => {
    it('objeto sem app/backupVersion lança Error com mensagem legível', () => {
      expect(() => applyBackup(db, 1, {} as never)).toThrow(Error)
      try {
        applyBackup(db, 1, {} as never)
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message.length).toBeGreaterThan(0)
      }
    })

    it('string lança Error com mensagem legível', () => {
      expect(() => applyBackup(db, 1, 'não é um backup' as never)).toThrow(Error)
    })

    it('null lança Error com mensagem legível', () => {
      expect(() => applyBackup(db, 1, null as never)).toThrow(Error)
    })
  })

  describe('backup sem o campo notes', () => {
    it('não lança; notes: 0', () => {
      const raw = buildRawBackup({})
      delete (raw as { notes?: unknown }).notes

      const result = applyBackup(db, 1, raw)
      expect(result.notes).toBe(0)
    })
  })

  describe('prefs com chave desconhecida/tipo errado', () => {
    it('chaves válidas aplicam, inválidas são ignoradas', () => {
      const rawPrefs = {
        ...DEFAULT_PREFS,
        backfillDays: 45,
        stalledDays: 'x',
        foo: 1
      } as unknown

      const raw = buildRawBackup({ prefs: rawPrefs as never })

      const result = applyBackup(db, 1, raw)

      expect(result.prefs).toBe(true)
      const prefs = getPrefs(db)
      expect(prefs.stalledDays).toBe(DEFAULT_PREFS.stalledDays)
      expect(prefs.backfillDays).toBe(45)
      expect((prefs as unknown as Record<string, unknown>).foo).toBeUndefined()
    })
  })
})

/** Monta um backup mínimo válido, sobrescrevendo os campos passados em overrides. */
function buildRawBackup(overrides: {
  notes?: Array<{ issueKey: string; content: string; updatedAt: string }>
  watches?: string[]
  filters?: Array<{ name: string; jql: string; position: number }>
  templates?: Array<{ name: string; content: string; position: number }>
  prefs?: Record<string, unknown>
}): {
  app: string
  backupVersion: number
  exportedAt: string
  siteUrl: string
  prefs: Record<string, unknown>
  notes: Array<{ issueKey: string; content: string; updatedAt: string }>
  watches: string[]
  filters: Array<{ name: string; jql: string; position: number }>
  templates: Array<{ name: string; content: string; position: number }>
} {
  return {
    app: 'jiraiya',
    backupVersion: 1,
    exportedAt: NOW,
    siteUrl: 'https://acme.atlassian.net',
    prefs: overrides.prefs ?? { ...DEFAULT_PREFS },
    notes: overrides.notes ?? [],
    watches: overrides.watches ?? [],
    filters: overrides.filters ?? [],
    templates: overrides.templates ?? []
  }
}
