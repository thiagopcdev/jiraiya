import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATION_COUNT, runMigrations } from './migrations'

describe('migrations', () => {
  it('aplica todas as migrations em DB vazio e é idempotente', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATION_COUNT)

    // idempotente
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATION_COUNT)

    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
        name: string
      }>
    ).map((t) => t.name)
    for (const t of [
      'workspace',
      'integration_credential',
      'project',
      'board',
      'sprint',
      'issue',
      'issue_activity',
      'summary',
      'alert',
      'sync_state',
      'user_pref'
    ]) {
      expect(tables).toContain(t)
    }
    db.close()
  })

  it('011: DB que vem da 010 ganha status_id e perde o cursor de issues', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    // simula o estado pré-011: coluna inexistente, cursor de issues gravado
    db.exec('ALTER TABLE issue DROP COLUMN status_id')
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at)
       VALUES (1, 'u', 'e', 'a', 'now')`
    ).run()
    db.prepare(
      `INSERT INTO sync_state (workspace_id, resource, cursor) VALUES
         (1, 'issues', '2026-08-01T00:00:00Z'),
         (1, 'prs', '2026-08-01T00:00:00Z')`
    ).run()
    db.pragma('user_version = 10')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATION_COUNT)
    const cols = (
      db.prepare(`SELECT name FROM pragma_table_info('issue')`).all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toContain('status_id')

    const cursors = db
      .prepare(`SELECT resource, cursor FROM sync_state ORDER BY resource`)
      .all() as Array<{ resource: string; cursor: string | null }>
    // o backfill precisa reprocessar as issues para preencher status_id;
    // os outros recursos não são afetados
    expect(cursors).toEqual([
      { resource: 'issues', cursor: null },
      { resource: 'prs', cursor: '2026-08-01T00:00:00Z' }
    ])
    db.close()
  })

  it('dedupe de activity por source_id', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('u', 'e', 'a', 'now')`
    ).run()
    const ins = db.prepare(
      `INSERT INTO issue_activity (workspace_id, issue_key, kind, occurred_at, source_id)
       VALUES (1, 'BT-1', 'comment', '2026-01-01T00:00:00Z', 'comment:1')
       ON CONFLICT(workspace_id, source_id) DO UPDATE SET body_text = excluded.body_text`
    )
    ins.run()
    ins.run()
    const count = db.prepare('SELECT COUNT(*) AS c FROM issue_activity').get() as { c: number }
    expect(count.c).toBe(1)
    db.close()
  })
})
