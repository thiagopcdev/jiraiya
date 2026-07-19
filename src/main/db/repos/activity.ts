import type Database from 'better-sqlite3'
import type { ActivityKind, IssueActivity } from '@shared/domain'

export interface ActivityInsert {
  issueKey: string
  kind: ActivityKind
  actorAccountId: string | null
  actorName: string | null
  field: string | null
  fromValue: string | null
  toValue: string | null
  bodyText: string | null
  occurredAt: string
  sourceId: string
}

/** Idempotente por source_id; comentários editados atualizam o body_text. */
export function insertActivities(
  db: Database.Database,
  workspaceId: number,
  activities: ActivityInsert[]
): void {
  if (activities.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO issue_activity (
      workspace_id, issue_key, kind, actor_account_id, actor_name,
      field, from_value, to_value, body_text, occurred_at, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, source_id) DO UPDATE SET body_text = excluded.body_text`
  )
  const run = db.transaction(() => {
    for (const a of activities) {
      stmt.run(
        workspaceId,
        a.issueKey,
        a.kind,
        a.actorAccountId,
        a.actorName,
        a.field,
        a.fromValue,
        a.toValue,
        a.bodyText,
        a.occurredAt,
        a.sourceId
      )
    }
  })
  run()
}

interface ActivityRow {
  id: number
  issue_key: string
  kind: string
  actor_account_id: string | null
  actor_name: string | null
  field: string | null
  from_value: string | null
  to_value: string | null
  body_text: string | null
  occurred_at: string
  summary?: string
  status?: string | null
}

function toDto(r: ActivityRow): IssueActivity {
  return {
    id: r.id,
    issueKey: r.issue_key,
    issueSummary: r.summary,
    issueStatus: r.status ?? null,
    kind: r.kind as ActivityKind,
    actorAccountId: r.actor_account_id,
    actorName: r.actor_name,
    field: r.field,
    fromValue: r.from_value,
    toValue: r.to_value,
    bodyText: r.body_text,
    occurredAt: r.occurred_at
  }
}

export function queryTimeline(
  db: Database.Database,
  workspaceId: number,
  opts: {
    start: string
    end: string
    actorAccountId?: string
    projectKey?: string
    limit?: number
  }
): IssueActivity[] {
  const conds = ['a.workspace_id = @workspaceId', 'a.occurred_at >= @start', 'a.occurred_at < @end']
  const params: Record<string, unknown> = {
    workspaceId,
    start: opts.start,
    end: opts.end,
    limit: opts.limit ?? 500
  }
  if (opts.actorAccountId) {
    conds.push('a.actor_account_id = @actor')
    params.actor = opts.actorAccountId
  }
  if (opts.projectKey) {
    conds.push('i.project_key = @projectKey')
    params.projectKey = opts.projectKey
  }
  const rows = db
    .prepare(
      `SELECT a.*, i.summary, i.status FROM issue_activity a
       LEFT JOIN issue i ON i.workspace_id = a.workspace_id AND i.key = a.issue_key
       WHERE ${conds.join(' AND ')}
       ORDER BY a.occurred_at DESC
       LIMIT @limit`
    )
    .all(params) as ActivityRow[]
  return rows.map(toDto)
}

/** Atividades de um card específico, mais recentes primeiro. */
export function listIssueActivities(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  limit = 100
): IssueActivity[] {
  const rows = db
    .prepare(
      `SELECT a.*, i.summary, i.status FROM issue_activity a
       LEFT JOIN issue i ON i.workspace_id = a.workspace_id AND i.key = a.issue_key
       WHERE a.workspace_id = ? AND a.issue_key = ?
       ORDER BY a.occurred_at DESC
       LIMIT ?`
    )
    .all(workspaceId, issueKey, limit) as ActivityRow[]
  return rows.map(toDto)
}

/** Última activity de cada issue (para regra de "parado há N dias"). */
export function lastActivityPerIssue(
  db: Database.Database,
  workspaceId: number
): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT issue_key, MAX(occurred_at) AS last_at FROM issue_activity
       WHERE workspace_id = ? GROUP BY issue_key`
    )
    .all(workspaceId) as Array<{ issue_key: string; last_at: string }>
  return new Map(rows.map((r) => [r.issue_key, r.last_at]))
}
