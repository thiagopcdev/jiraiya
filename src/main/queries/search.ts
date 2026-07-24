import type Database from 'better-sqlite3'
import type { StatusCategory } from '@shared/domain'

/** Resultado de busca global (FTS5) — issues por título/descrição e comentários. */
export interface GlobalSearchResult {
  key: string
  summary: string
  status: string | null
  statusCategory: StatusCategory | null
  url: string
  snippet: string | null
  match: 'title' | 'description' | 'comment'
}

/**
 * Sanitiza a query do usuário para a sintaxe do FTS5:
 * split por whitespace; cada token vira `"tok"*` (prefix search, aspas duplas
 * escapadas dobrando); join por espaço (AND implícito). Tokens vazios ignorados.
 * Retorna null quando nada sobra.
 */
function buildFtsQuery(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
  if (tokens.length === 0) return null
  return tokens.join(' ')
}

function browseUrl(siteUrl: string, key: string): string {
  return `${siteUrl.replace(/\/$/, '')}/browse/${key}`
}

interface Row {
  key: string
  summary: string
  status: string | null
  status_category: string | null
  snippet: string | null
}

/**
 * Busca full-text em 3 fontes, por prioridade: (1) título da issue, (2) descrição
 * da issue, (3) comentários. Dedupe por key mantendo a maior prioridade
 * (title > description > comment). Ordem final: títulos, depois descrições, depois
 * comentários; dentro de cada grupo por rank. `limit` vale no total.
 */
export function searchGlobal(
  db: Database.Database,
  workspaceId: number,
  siteUrl: string,
  query: string,
  limit = 20
): GlobalSearchResult[] {
  const fts = buildFtsQuery(query)
  if (!fts) return []

  const titleRows = db
    .prepare(
      `SELECT i.key AS key, i.summary AS summary, i.status AS status,
              i.status_category AS status_category, NULL AS snippet
       FROM issue_fts f
       JOIN issue i ON i.id = f.rowid
       WHERE i.workspace_id = ? AND issue_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(workspaceId, `summary : (${fts})`, limit) as Row[]

  const descRows = db
    .prepare(
      `SELECT i.key AS key, i.summary AS summary, i.status AS status,
              i.status_category AS status_category,
              snippet(issue_fts, 1, '「', '」', '…', 12) AS snippet
       FROM issue_fts f
       JOIN issue i ON i.id = f.rowid
       WHERE i.workspace_id = ? AND issue_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(workspaceId, `description : (${fts})`, limit) as Row[]

  const commentRows = db
    .prepare(
      `SELECT ia.issue_key AS key, i.summary AS summary, i.status AS status,
              i.status_category AS status_category,
              snippet(comment_fts, 0, '「', '」', '…', 12) AS snippet
       FROM comment_fts f
       JOIN issue_activity ia ON ia.id = f.rowid
       JOIN issue i ON i.key = ia.issue_key AND i.workspace_id = ia.workspace_id
       WHERE ia.workspace_id = ? AND comment_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(workspaceId, fts, limit) as Row[]

  const seen = new Set<string>()
  const results: GlobalSearchResult[] = []

  const groups: Array<{ rows: Row[]; match: GlobalSearchResult['match'] }> = [
    { rows: titleRows, match: 'title' },
    { rows: descRows, match: 'description' },
    { rows: commentRows, match: 'comment' }
  ]

  for (const { rows, match } of groups) {
    for (const r of rows) {
      if (results.length >= limit) return results
      if (seen.has(r.key)) continue
      seen.add(r.key)
      results.push({
        key: r.key,
        summary: r.summary,
        status: r.status,
        statusCategory: (r.status_category as StatusCategory | null) ?? null,
        url: browseUrl(siteUrl, r.key),
        snippet: match === 'title' ? null : r.snippet,
        match
      })
    }
  }

  return results.slice(0, limit)
}
