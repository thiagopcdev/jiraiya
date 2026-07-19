import type Database from 'better-sqlite3'
import type { VelocitySprint, VelocitySummary } from '@shared/domain'
import { listRecentSprints } from '../db/repos/catalog'

export interface VelocityCtx {
  db: Database.Database
  workspaceId: number
  accountId: string
}

interface AggRow {
  teamCount: number
  teamPoints: number
  myCount: number
  myPoints: number
}

/**
 * Entregas por sprint (velocity). "Entregue" = `resolved_at` na janela temporal
 * da sprint `[start, end)`, nunca por associação `sprint_jira_id`. Regra "meu" é
 * a mesma do bucket `done`: assignee atual OU quem fez a atividade `resolved`.
 *
 * Sobre a semântica das barras vs. totals:
 * - As barras por sprint podem dupla-contar uma issue quando sprints de boards
 *   diferentes se sobrepõem no tempo (semântica "entregue durante esta sprint").
 * - `totals` roda o MESMO agregado UMA vez sobre a janela global e por isso nunca
 *   infla: cada issue conta no máximo uma vez.
 * - Uma issue com `resolved_at` fora de qualquer janela de sprint (mas dentro da
 *   janela global) pode entrar só no `totals` global, não nas barras.
 */
export function buildVelocity(ctx: VelocityCtx, opts: { sprintCount: number }): VelocitySummary {
  const { db, workspaceId, accountId } = ctx
  const sprints = listRecentSprints(db, workspaceId, opts.sprintCount)

  if (sprints.length === 0) {
    return { sprints: [], totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 } }
  }

  const nowIso = new Date().toISOString()

  // UM prepared statement de agregação, reusado por sprint e para o total.
  const agg = db.prepare(
    `SELECT
       COUNT(*) AS teamCount,
       COALESCE(SUM(COALESCE(i.story_points, 0)), 0) AS teamPoints,
       COALESCE(SUM(CASE WHEN i.assignee_account_id = @accountId OR EXISTS (
           SELECT 1 FROM issue_activity a
           WHERE a.workspace_id = i.workspace_id AND a.issue_key = i.key
             AND a.actor_account_id = @accountId AND a.kind = 'resolved'
         ) THEN 1 ELSE 0 END), 0) AS myCount,
       COALESCE(SUM(CASE WHEN i.assignee_account_id = @accountId OR EXISTS (
           SELECT 1 FROM issue_activity a
           WHERE a.workspace_id = i.workspace_id AND a.issue_key = i.key
             AND a.actor_account_id = @accountId AND a.kind = 'resolved'
         ) THEN COALESCE(i.story_points, 0) ELSE 0 END), 0) AS myPoints
     FROM issue i
     WHERE i.workspace_id = @workspaceId
       AND i.resolved_at IS NOT NULL
       AND i.resolved_at >= @start AND i.resolved_at < @end`
  )

  const effectiveEnd = (s: (typeof sprints)[number]): string =>
    s.completeDate ?? s.endDate ?? nowIso

  // listRecentSprints vem DESC (mais nova → mais antiga); reverte p/ mais antiga → mais nova.
  const ordered = [...sprints].reverse()

  const velocitySprints: VelocitySprint[] = ordered.map((s): VelocitySprint => {
    const start = s.startDate
    const end = effectiveEnd(s)
    const row = agg.get({ workspaceId, accountId, start, end }) as AggRow
    return {
      sprintJiraId: s.jiraId,
      name: s.name,
      state: s.state,
      startDate: start,
      endDate: end,
      myPoints: row.myPoints,
      teamPoints: row.teamPoints,
      myCount: row.myCount,
      teamCount: row.teamCount
    }
  })

  // totals: mesmo agregado UMA vez sobre a janela global — deduplica issues em
  // sprints sobrepostas de boards diferentes.
  const globalStart = sprints.reduce(
    (min, s) => (s.startDate < min ? s.startDate : min),
    sprints[0].startDate
  )
  const globalEnd = ordered.reduce((max, s) => {
    const e = effectiveEnd(s)
    return e > max ? e : max
  }, effectiveEnd(ordered[0]))

  const totalsRow = agg.get({
    workspaceId,
    accountId,
    start: globalStart,
    end: globalEnd
  }) as AggRow

  return {
    sprints: velocitySprints,
    totals: {
      myPoints: totalsRow.myPoints,
      teamPoints: totalsRow.teamPoints,
      myCount: totalsRow.myCount,
      teamCount: totalsRow.teamCount
    }
  }
}
