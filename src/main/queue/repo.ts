import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { PendingAction, PendingActionType } from '@shared/domain'

/** Ação enfileirada na fila offline (tabela pending_action, migration 008). */
export interface PendingActionRow {
  id: number
  workspace_id: number
  issue_key: string
  type: PendingActionType
  /** JSON do payload da ação (shape por tipo, sempre com `summary`) */
  payload: string
  local_uuid: string
  status: 'pending' | 'inflight' | 'failed'
  attempts: number
  last_error: string | null
  created_at: string
}

const SELECT_COLUMNS =
  'id, workspace_id, issue_key, type, payload, local_uuid, status, attempts, last_error, created_at'

/** Rótulo humano usado quando o payload não trouxe um summary. */
const TYPE_LABEL: Record<PendingActionType, string> = {
  comment: 'Comentário',
  transition: 'Transição',
  worklog: 'Apontamento',
  update: 'Edição'
}

export function enqueueAction(
  db: Database.Database,
  workspaceId: number,
  input: { issueKey: string; type: PendingActionType; payload: Record<string, unknown> }
): PendingActionRow {
  const localUuid = randomUUID()
  const createdAt = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO pending_action
         (workspace_id, issue_key, type, payload, local_uuid, status, attempts, last_error, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?)`
    )
    .run(
      workspaceId,
      input.issueKey,
      input.type,
      JSON.stringify(input.payload),
      localUuid,
      createdAt
    )

  return {
    id: Number(info.lastInsertRowid),
    workspace_id: workspaceId,
    issue_key: input.issueKey,
    type: input.type,
    payload: JSON.stringify(input.payload),
    local_uuid: localUuid,
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: createdAt
  }
}

/** Fila completa (qualquer status), mais antiga primeiro. */
export function listActions(db: Database.Database, workspaceId: number): PendingActionRow[] {
  return db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM pending_action WHERE workspace_id = ? ORDER BY id ASC`)
    .all(workspaceId) as PendingActionRow[]
}

/**
 * Ações ainda pendentes agrupadas por card, FIFO dentro de cada grupo — o drain
 * respeita a ordem original por card (uma transição pode depender da anterior).
 */
export function nextPendingByIssue(
  db: Database.Database,
  workspaceId: number
): Map<string, PendingActionRow[]> {
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM pending_action
       WHERE workspace_id = ? AND status = 'pending' ORDER BY id ASC`
    )
    .all(workspaceId) as PendingActionRow[]

  const grouped = new Map<string, PendingActionRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.issue_key)
    if (list) list.push(row)
    else grouped.set(row.issue_key, [row])
  }
  return grouped
}

export function markInflight(db: Database.Database, id: number): void {
  db.prepare(`UPDATE pending_action SET status = 'inflight' WHERE id = ?`).run(id)
}

/** Volta para a fila (erro de rede): mantém pendente e contabiliza a tentativa. */
export function markPendingAgain(db: Database.Database, id: number, error: string): void {
  db.prepare(
    `UPDATE pending_action SET status = 'pending', attempts = attempts + 1, last_error = ?
     WHERE id = ?`
  ).run(error, id)
}

export function markFailed(db: Database.Database, id: number, error: string): void {
  db.prepare(
    `UPDATE pending_action SET status = 'failed', attempts = attempts + 1, last_error = ?
     WHERE id = ?`
  ).run(error, id)
}

export function removeAction(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM pending_action WHERE id = ?').run(id)
}

/** Contagens para o badge da fila ('inflight' ainda é uma ação pendente). */
export function queueCounts(
  db: Database.Database,
  workspaceId: number
): { pending: number; failed: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('pending', 'inflight') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM pending_action WHERE workspace_id = ?`
    )
    .get(workspaceId) as { pending: number | null; failed: number | null } | undefined
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 }
}

/** Row → DTO do renderer; summary vem do payload (fallback: rótulo do tipo). */
export function toPendingAction(row: PendingActionRow): PendingAction {
  let summary: string | null = null
  try {
    const parsed = JSON.parse(row.payload) as { summary?: unknown }
    if (typeof parsed.summary === 'string' && parsed.summary !== '') summary = parsed.summary
  } catch {
    summary = null
  }
  return {
    id: row.id,
    issueKey: row.issue_key,
    type: row.type,
    summary: summary ?? TYPE_LABEL[row.type] ?? row.type,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at
  }
}
