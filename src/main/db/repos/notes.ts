import type Database from 'better-sqlite3'

/** Nota privada de um card (tabela issue_note, migration 006). */
export interface IssueNote {
  content: string | null
  updatedAt: string | null
}

export function getNote(db: Database.Database, workspaceId: number, issueKey: string): IssueNote {
  const row = db
    .prepare('SELECT content, updated_at FROM issue_note WHERE workspace_id = ? AND issue_key = ?')
    .get(workspaceId, issueKey) as { content: string; updated_at: string } | undefined
  if (!row) return { content: null, updatedAt: null }
  return { content: row.content, updatedAt: row.updated_at }
}

/** Grava a nota; conteúdo vazio (ou só espaços) apaga a linha. */
export function setNote(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  content: string
): void {
  if (content.trim() === '') {
    db.prepare('DELETE FROM issue_note WHERE workspace_id = ? AND issue_key = ?').run(
      workspaceId,
      issueKey
    )
    return
  }
  db.prepare(
    `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, issue_key) DO UPDATE SET
       content = excluded.content, updated_at = excluded.updated_at`
  ).run(workspaceId, issueKey, content, new Date().toISOString())
}
