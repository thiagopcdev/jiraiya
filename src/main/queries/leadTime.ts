import type Database from 'better-sqlite3'
import type { LeadTimeStat } from '@shared/domain'

export interface LeadTimeCtx {
  db: Database.Database
  workspaceId: number
  accountId: string
}

const DAY_MS = 86400000

/**
 * Pura: reconstrói a linha do tempo de status de um card e devolve os dias
 * passados em cada status. O primeiro segmento começa em `createdAt` no status
 * `fromValue` do primeiro change; cada change fecha o segmento corrente e abre
 * o próximo no seu `toValue`; o último segmento vai do último change até `endAt`.
 * Segmentos negativos (relógio inconsistente) são ignorados. Sem changes → [].
 */
export function statusDurationsDays(
  changes: Array<{ fromValue: string | null; toValue: string | null; occurredAt: string }>,
  createdAt: string,
  endAt: string
): Array<{ status: string; days: number }> {
  if (changes.length === 0) return []
  const sorted = [...changes].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  const msByStatus = new Map<string, number>()
  const add = (status: string | null, ms: number): void => {
    if (status === null || ms < 0) return
    msByStatus.set(status, (msByStatus.get(status) ?? 0) + ms)
  }

  let segStart = new Date(createdAt).getTime()
  let segStatus: string | null = sorted[0].fromValue
  for (const c of sorted) {
    const at = new Date(c.occurredAt).getTime()
    add(segStatus, at - segStart)
    segStart = at
    segStatus = c.toValue
  }
  add(segStatus, new Date(endAt).getTime() - segStart)

  return [...msByStatus.entries()].map(([status, ms]) => ({ status, days: ms / DAY_MS }))
}

interface ResolvedIssueRow {
  key: string
  created_at: string | null
  resolved_at: string
}

interface StatusChangeRow {
  from_value: string | null
  to_value: string | null
  occurred_at: string
}

/**
 * Tempo médio (dias) que MEUS cards passaram em cada status, sobre os cards
 * resolvidos na janela `[now - days, now)`. Regra "meu" idêntica à velocity:
 * assignee atual OU autor da atividade `resolved`.
 */
export function buildLeadTime(
  ctx: LeadTimeCtx,
  opts: { days: number }
): { statuses: LeadTimeStat[]; cardCount: number; windowDays: number } {
  const { db, workspaceId, accountId } = ctx
  const now = Date.now()
  const start = new Date(now - opts.days * DAY_MS).toISOString()
  const end = new Date(now).toISOString()

  const issues = db
    .prepare(
      `SELECT key, created_at, resolved_at FROM issue i
       WHERE i.workspace_id = @workspaceId
         AND i.resolved_at IS NOT NULL
         AND i.resolved_at >= @start AND i.resolved_at < @end
         AND (i.assignee_account_id = @accountId OR EXISTS (
           SELECT 1 FROM issue_activity a
           WHERE a.workspace_id = i.workspace_id AND a.issue_key = i.key
             AND a.actor_account_id = @accountId AND a.kind = 'resolved'
         ))`
    )
    .all({ workspaceId, accountId, start, end }) as ResolvedIssueRow[]

  const changesStmt = db.prepare(
    `SELECT from_value, to_value, occurred_at FROM issue_activity
     WHERE workspace_id = ? AND issue_key = ? AND kind = 'status_change'
     ORDER BY occurred_at ASC`
  )

  const agg = new Map<string, { total: number; samples: number }>()

  for (const issue of issues) {
    const changeRows = changesStmt.all(workspaceId, issue.key) as StatusChangeRow[]
    const changes = changeRows.map((r) => ({
      fromValue: r.from_value,
      toValue: r.to_value,
      occurredAt: r.occurred_at
    }))
    const createdAt = issue.created_at ?? changes[0]?.occurredAt ?? issue.resolved_at
    const durations = statusDurationsDays(changes, createdAt, issue.resolved_at)
    for (const { status, days } of durations) {
      const cur = agg.get(status) ?? { total: 0, samples: 0 }
      cur.total += days
      cur.samples += 1
      agg.set(status, cur)
    }
  }

  const statuses: LeadTimeStat[] = [...agg.entries()]
    .map(([status, { total, samples }]) => ({
      status,
      avgDays: Math.round((total / samples) * 10) / 10,
      samples
    }))
    .sort((a, b) => b.avgDays - a.avgDays)

  return { statuses, cardCount: issues.length, windowDays: opts.days }
}
