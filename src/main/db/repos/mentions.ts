import type Database from 'better-sqlite3'
import type { Mention } from '@shared/domain'
import type { MentionInsert } from '../../sync/mentions'

const EXCERPT_MAX = 280

/**
 * Insere menções idempotente por UNIQUE(workspace_id, source_id).
 * `markRead` grava já lidas (backfill/histórico não deve inundar).
 * Retorna SOMENTE as que foram de fato inseridas agora (info.changes > 0).
 */
export function insertMentions(
  db: Database.Database,
  workspaceId: number,
  mentions: MentionInsert[],
  opts?: { markRead?: boolean }
): MentionInsert[] {
  if (mentions.length === 0) return []
  const readAt = opts?.markRead ? new Date().toISOString() : null
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO mention
      (workspace_id, issue_key, source_id, author_account_id, author_name, excerpt, occurred_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const inserted: MentionInsert[] = []
  const run = db.transaction(() => {
    for (const m of mentions) {
      const info = stmt.run(
        workspaceId,
        m.issueKey,
        m.sourceId,
        m.authorAccountId,
        m.authorName,
        m.excerpt,
        m.occurredAt,
        readAt
      )
      if (info.changes > 0) inserted.push(m)
    }
  })
  run()
  return inserted
}

interface MentionRow {
  id: number
  issue_key: string
  summary: string | null
  author_account_id: string | null
  author_name: string | null
  excerpt: string | null
  occurred_at: string
  read_at: string | null
}

export function listMentions(db: Database.Database, workspaceId: number, limit = 200): Mention[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.issue_key, i.summary, m.author_account_id, m.author_name,
              m.excerpt, m.occurred_at, m.read_at
       FROM mention m
       LEFT JOIN issue i ON i.workspace_id = m.workspace_id AND i.key = m.issue_key
       WHERE m.workspace_id = ?
       ORDER BY m.occurred_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as MentionRow[]
  return rows.map((r) => ({
    id: r.id,
    issueKey: r.issue_key,
    issueSummary: r.summary,
    authorAccountId: r.author_account_id,
    authorName: r.author_name,
    excerpt: r.excerpt,
    occurredAt: r.occurred_at,
    readAt: r.read_at
  }))
}

export function unreadCount(db: Database.Database, workspaceId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM mention WHERE workspace_id = ? AND read_at IS NULL')
    .get(workspaceId) as { n: number }
  return row.n
}

export function markAllRead(db: Database.Database, workspaceId: number): void {
  db.prepare('UPDATE mention SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL').run(
    new Date().toISOString(),
    workspaceId
  )
}

interface SeedActivityRow {
  issue_key: string
  source_id: string
  actor_account_id: string | null
  actor_name: string | null
  body_text: string | null
  occurred_at: string
}

/**
 * Popula o inbox uma vez a partir de comentários já sincronizados que citam o
 * nome do usuário (o ADF cru não está guardado; heurística por body_text).
 * Histórico nasce lido. Idempotente por UNIQUE(workspace_id, source_id).
 */
export function seedMentionHistory(
  db: Database.Database,
  workspaceId: number,
  displayName: string
): void {
  const now = new Date().toISOString()
  const rows = db
    .prepare(
      `SELECT issue_key, source_id, actor_account_id, actor_name, body_text, occurred_at
       FROM issue_activity
       WHERE workspace_id = ? AND kind = 'comment' AND body_text LIKE '%@' || ? || '%'`
    )
    .all(workspaceId, displayName) as SeedActivityRow[]
  if (rows.length === 0) return
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO mention
      (workspace_id, issue_key, source_id, author_account_id, author_name, excerpt, occurred_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const run = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        workspaceId,
        r.issue_key,
        r.source_id,
        r.actor_account_id,
        r.actor_name,
        truncate(r.body_text),
        r.occurred_at,
        now
      )
    }
  })
  run()
}

function truncate(text: string | null): string | null {
  if (text === null || text.length === 0) return null
  if (text.length <= EXCERPT_MAX) return text
  return text.slice(0, EXCERPT_MAX) + '…'
}
