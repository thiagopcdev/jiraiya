import type Database from 'better-sqlite3'
import type { CommandLogEntry } from '@shared/domain'

/**
 * Auditoria dos comandos externos disparados pelo app (tabela command_log,
 * migration 009): CLIs de IA e chamadas HTTP a provedores.
 *
 * A tabela é global (não por workspace) e auto-limitada: só as
 * MAX_ENTRIES linhas mais recentes ficam guardadas. O `command` chega aqui
 * JÁ redigido (prompt truncado, nunca keys/headers) — ver ai/audit.ts.
 */

const MAX_ENTRIES = 500

export function logCommand(
  db: Database.Database,
  input: {
    kind: 'cli' | 'http'
    provider: string
    feature: string | null
    command: string
    durationMs: number | null
    ok: boolean
    error: string | null
  }
): void {
  db.prepare(
    `INSERT INTO command_log (ts, kind, provider, feature, command, duration_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    input.kind,
    input.provider,
    input.feature,
    input.command,
    input.durationMs,
    input.ok ? 1 : 0,
    input.error
  )
  // poda a cauda: histórico de auditoria não deve crescer sem limite
  db.prepare(
    `DELETE FROM command_log
     WHERE id NOT IN (SELECT id FROM command_log ORDER BY id DESC LIMIT ${MAX_ENTRIES})`
  ).run()
}

/** Mais recente primeiro. */
export function listCommandLog(db: Database.Database, limit = 200): CommandLogEntry[] {
  const rows = db
    .prepare(
      `SELECT id, ts, kind, provider, feature, command, duration_ms, ok, error
       FROM command_log ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: number
    ts: string
    kind: string
    provider: string
    feature: string | null
    command: string
    duration_ms: number | null
    ok: number
    error: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind as 'cli' | 'http',
    provider: r.provider,
    feature: r.feature,
    command: r.command,
    durationMs: r.duration_ms,
    ok: r.ok === 1,
    error: r.error
  }))
}

export function clearCommandLog(db: Database.Database): void {
  db.prepare('DELETE FROM command_log').run()
}
