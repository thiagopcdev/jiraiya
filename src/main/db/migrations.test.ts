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
