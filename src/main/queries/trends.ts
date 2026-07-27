import type Database from 'better-sqlite3'
import type { SprintTrend } from '@shared/domain'

interface SprintRow {
  jira_id: number
  name: string | null
  start_date: string
  end_date: string | null
  complete_date: string | null
}

interface DeliveredRow {
  story_points: number | null
  created_at: string | null
  resolved_at: string
}

const MS_PER_DAY = 86_400_000

/**
 * Tendências por sprint FECHADA (entrega, lead time e scope creep), da mais
 * antiga para a mais recente.
 *
 * REGRA DO PROJETO: histórico por sprint é SEMPRE por janela temporal em
 * `resolved_at` / `created_at` — `issue.sprint_jira_id` guarda apenas a última
 * sprint do card e por isso não serve para histórico. Janela de cada sprint:
 * `[start_date, COALESCE(complete_date, end_date))`; sprint sem fim definido é
 * ignorada. Comparação de datas é lexicográfica sobre strings ISO (mesmo
 * padrão de `queries/velocity.ts`).
 *
 * Métricas são do TIME todo (não filtram por usuário). Sprints de boards
 * diferentes que se sobrepõem no tempo podem contar a mesma issue duas vezes —
 * é a semântica "entregue durante esta sprint", igual à do velocity.
 */
export function sprintTrends(
  db: Database.Database,
  workspaceId: number,
  sprintCount = 6
): SprintTrend[] {
  // as `sprintCount` sprints fechadas mais recentes (DESC), revertidas depois
  const rows = db
    .prepare(
      `SELECT jira_id, name, start_date, end_date, complete_date
       FROM sprint
       WHERE workspace_id = ? AND state = 'closed' AND start_date IS NOT NULL
       ORDER BY start_date DESC LIMIT ?`
    )
    .all(workspaceId, sprintCount) as SprintRow[]

  if (rows.length === 0) return []

  const deliveredStmt = db.prepare(
    `SELECT story_points, created_at, resolved_at
     FROM issue
     WHERE workspace_id = @workspaceId
       AND resolved_at IS NOT NULL
       AND resolved_at >= @start AND resolved_at < @end`
  )

  const createdStmt = db.prepare(
    `SELECT COUNT(*) AS n
     FROM issue
     WHERE workspace_id = @workspaceId
       AND created_at IS NOT NULL
       AND created_at >= @start AND created_at < @end`
  )

  const trends: SprintTrend[] = []

  // rows vem DESC (mais nova → mais antiga); reverte p/ mais antiga → mais nova.
  for (const r of [...rows].reverse()) {
    const start = r.start_date
    const end = r.complete_date ?? r.end_date
    // sem fim definido não há janela fechável — pula a sprint
    if (!end) continue

    const delivered = deliveredStmt.all({ workspaceId, start, end }) as DeliveredRow[]

    let deliveredSp = 0
    let leadSum = 0
    let leadSamples = 0
    for (const d of delivered) {
      deliveredSp += d.story_points ?? 0
      if (!d.created_at) continue
      const createdMs = Date.parse(d.created_at)
      const resolvedMs = Date.parse(d.resolved_at)
      if (Number.isNaN(createdMs) || Number.isNaN(resolvedMs)) continue
      leadSum += (resolvedMs - createdMs) / MS_PER_DAY
      leadSamples += 1
    }

    const createdRow = createdStmt.get({ workspaceId, start, end }) as { n: number }

    trends.push({
      jiraId: r.jira_id,
      name: r.name,
      endDate: end,
      deliveredSp,
      deliveredCount: delivered.length,
      avgLeadDays: leadSamples > 0 ? Math.round((leadSum / leadSamples) * 10) / 10 : null,
      createdDuringCount: createdRow.n
    })
  }

  return trends
}
