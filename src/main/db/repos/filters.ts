import type Database from 'better-sqlite3'

/** Filtros JQL salvos pelo usuário (tabela jql_filter, migration 004). */
export interface JqlFilter {
  id: number
  name: string
  jql: string
  position: number
}

interface JqlFilterRow {
  id: number
  name: string
  jql: string
  position: number
}

export function listFilters(db: Database.Database, workspaceId: number): JqlFilter[] {
  const rows = db
    .prepare(
      `SELECT id, name, jql, position FROM jql_filter
       WHERE workspace_id = ? ORDER BY position, id`
    )
    .all(workspaceId) as JqlFilterRow[]
  return rows.map((r) => ({ id: r.id, name: r.name, jql: r.jql, position: r.position }))
}

/** Insere (position = max+1) ou atualiza por id. Retorna o id afetado. */
export function saveFilter(
  db: Database.Database,
  workspaceId: number,
  f: { id?: number; name: string; jql: string }
): number {
  if (f.id !== undefined) {
    db.prepare(`UPDATE jql_filter SET name = ?, jql = ? WHERE workspace_id = ? AND id = ?`).run(
      f.name,
      f.jql,
      workspaceId,
      f.id
    )
    return f.id
  }
  const row = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM jql_filter WHERE workspace_id = ?`)
    .get(workspaceId) as { pos: number }
  const info = db
    .prepare(
      `INSERT INTO jql_filter (workspace_id, name, jql, position, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(workspaceId, f.name, f.jql, row.pos, new Date().toISOString())
  return Number(info.lastInsertRowid)
}

export function deleteFilter(db: Database.Database, workspaceId: number, id: number): void {
  db.prepare('DELETE FROM jql_filter WHERE workspace_id = ? AND id = ?').run(workspaceId, id)
}
