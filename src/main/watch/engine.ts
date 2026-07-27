import type Database from 'better-sqlite3'
import { listWatches, updateWatchState } from '../db/repos/watch'

export interface WatchEvent {
  issueKey: string
  summary: string
  kind: 'status' | 'activity'
  message: string
}

interface ActivityRow {
  kind: string
  actor_account_id: string | null
  occurred_at: string
}

/** Maior das duas datas ISO (comparação lexicográfica serve para ISO 8601 UTC). */
function maxIso(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/**
 * Compara o estado atual das issues seguidas com o snapshot da última execução e
 * devolve os eventos novos (mudança de status e comentários de outras pessoas).
 *
 * Sempre reposiciona o snapshot (last_status / last_activity_at), inclusive
 * quando não há evento — o baseline nunca usa o relógio, só o maior occurred_at
 * das atividades já conhecidas localmente, para não perder atividade que
 * sincronize atrasada.
 */
export function runWatchEngine(
  db: Database.Database,
  workspaceId: number,
  selfAccountId: string
): WatchEvent[] {
  const events: WatchEvent[] = []

  const issueStmt = db.prepare(
    'SELECT summary, status FROM issue WHERE workspace_id = ? AND key = ?'
  )
  const activityStmt = db.prepare(
    `SELECT kind, actor_account_id, occurred_at FROM issue_activity
     WHERE workspace_id = ? AND issue_key = ?`
  )

  for (const watch of listWatches(db, workspaceId)) {
    const issue = issueStmt.get(workspaceId, watch.issueKey) as
      { summary: string; status: string | null } | undefined
    // card ainda não sincronizado localmente — nada a comparar
    if (!issue) continue

    if (watch.lastStatus !== null && watch.lastStatus !== issue.status) {
      events.push({
        issueKey: watch.issueKey,
        summary: issue.summary,
        kind: 'status',
        message: `${watch.issueKey}: ${watch.lastStatus} → ${issue.status}`
      })
    }

    const activities = activityStmt.all(workspaceId, watch.issueKey) as ActivityRow[]

    if (watch.lastActivityAt !== null) {
      const fresh = activities.filter(
        (a) =>
          a.occurred_at > watch.lastActivityAt! &&
          a.actor_account_id !== null &&
          a.actor_account_id !== selfAccountId &&
          (a.kind === 'comment' || a.kind === 'status_change')
      )
      const comments = fresh.filter((a) => a.kind === 'comment').length
      if (comments > 0) {
        events.push({
          issueKey: watch.issueKey,
          summary: issue.summary,
          kind: 'activity',
          message: `${watch.issueKey}: ${comments} novo(s) comentário(s)`
        })
      }
    }

    const seenMax = activities.reduce<string | null>((acc, a) => maxIso(acc, a.occurred_at), null)
    // sem atividade conhecida → mantém o baseline anterior (inclusive NULL)
    const nextActivityAt = maxIso(seenMax, watch.lastActivityAt)
    updateWatchState(db, workspaceId, watch.issueKey, issue.status, nextActivityAt)
  }

  return events
}
