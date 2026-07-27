import type Database from 'better-sqlite3'

/** Card seguido pelo usuário (tabela watch, migration 006). */
export interface WatchRow {
  id: number
  issueKey: string
  lastStatus: string | null
  lastActivityAt: string | null
}

interface WatchDbRow {
  id: number
  issue_key: string
  last_status: string | null
  last_activity_at: string | null
}

export function isWatching(db: Database.Database, workspaceId: number, issueKey: string): boolean {
  const row = db
    .prepare('SELECT 1 AS one FROM watch WHERE workspace_id = ? AND issue_key = ?')
    .get(workspaceId, issueKey) as { one: number } | undefined
  return row !== undefined
}

/**
 * Liga/desliga o watch do card. Retorna o NOVO estado.
 *
 * Ao criar, semeia last_status/last_activity_at com o estado atual conhecido
 * localmente — assim o engine não dispara eventos retroativos no primeiro sync
 * depois de seguir o card.
 */
export function toggleWatch(db: Database.Database, workspaceId: number, issueKey: string): boolean {
  if (isWatching(db, workspaceId, issueKey)) {
    db.prepare('DELETE FROM watch WHERE workspace_id = ? AND issue_key = ?').run(
      workspaceId,
      issueKey
    )
    return false
  }

  const issue = db
    .prepare('SELECT status FROM issue WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, issueKey) as { status: string | null } | undefined
  const activity = db
    .prepare(
      `SELECT MAX(occurred_at) AS last_at FROM issue_activity
       WHERE workspace_id = ? AND issue_key = ?`
    )
    .get(workspaceId, issueKey) as { last_at: string | null } | undefined

  db.prepare(
    `INSERT INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    workspaceId,
    issueKey,
    issue?.status ?? null,
    activity?.last_at ?? null,
    new Date().toISOString()
  )
  return true
}

/** Cards seguidos, os mais recentes primeiro. */
export function listWatches(db: Database.Database, workspaceId: number): WatchRow[] {
  const rows = db
    .prepare(
      `SELECT id, issue_key, last_status, last_activity_at FROM watch
       WHERE workspace_id = ? ORDER BY created_at DESC, id DESC`
    )
    .all(workspaceId) as WatchDbRow[]
  return rows.map((r) => ({
    id: r.id,
    issueKey: r.issue_key,
    lastStatus: r.last_status,
    lastActivityAt: r.last_activity_at
  }))
}

export function updateWatchState(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  lastStatus: string | null,
  /** null = card seguido sem nenhuma atividade local ainda (mantém o baseline vazio) */
  lastActivityAt: string | null
): void {
  db.prepare(
    `UPDATE watch SET last_status = ?, last_activity_at = ?
     WHERE workspace_id = ? AND issue_key = ?`
  ).run(lastStatus, lastActivityAt, workspaceId, issueKey)
}
