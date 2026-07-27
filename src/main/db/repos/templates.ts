import type Database from 'better-sqlite3'

/** Template de comentário salvo pelo usuário (tabela comment_template, migration 007). */
export interface CommentTemplate {
  id: number
  name: string
  content: string
}

interface CommentTemplateRow {
  id: number
  name: string
  content: string
}

export function listTemplates(db: Database.Database, workspaceId: number): CommentTemplate[] {
  const rows = db
    .prepare(
      `SELECT id, name, content FROM comment_template
       WHERE workspace_id = ? ORDER BY position, id`
    )
    .all(workspaceId) as CommentTemplateRow[]
  return rows.map((r) => ({ id: r.id, name: r.name, content: r.content }))
}

/**
 * Insere (position = max+1) ou atualiza por id. Retorna o template resultante.
 * id de outro workspace (ou inexistente) é erro — nunca cria silenciosamente.
 */
export function saveTemplate(
  db: Database.Database,
  workspaceId: number,
  input: { id?: number; name: string; content: string }
): CommentTemplate {
  if (input.id !== undefined) {
    const info = db
      .prepare(
        `UPDATE comment_template SET name = ?, content = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .run(input.name, input.content, workspaceId, input.id)
    if (info.changes === 0) throw new Error('Template não encontrado')
    return { id: input.id, name: input.name, content: input.content }
  }

  const row = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM comment_template WHERE workspace_id = ?`
    )
    .get(workspaceId) as { pos: number }
  const info = db
    .prepare(
      `INSERT INTO comment_template (workspace_id, name, content, position, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(workspaceId, input.name, input.content, row.pos, new Date().toISOString())
  return { id: Number(info.lastInsertRowid), name: input.name, content: input.content }
}

/** Apaga o template; silencioso quando não existe (ou é de outro workspace). */
export function deleteTemplate(db: Database.Database, workspaceId: number, id: number): void {
  db.prepare('DELETE FROM comment_template WHERE workspace_id = ? AND id = ?').run(workspaceId, id)
}
