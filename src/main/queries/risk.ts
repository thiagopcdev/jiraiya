import type Database from 'better-sqlite3'
import type { Issue } from '@shared/domain'
import { queryIssues } from './issues'
import { getActiveSprint } from '../db/repos/catalog'

const DAY_MS = 86400000

export interface RiskItem {
  issue: Issue
  signals: string[]
  score: number
}

/**
 * Pura: deriva os sinais de risco de um card a partir de métricas já calculadas.
 * score = número de sinais. Strings pt-BR fixas (o renderer as exibe direto).
 */
export function computeRiskSignals(input: {
  issue: Issue
  /** dias no status atual; null = sem status_change registrado */
  daysInCurrentStatus: number | null
  rejectionsInWindow: number
  daysSinceLastActivity: number | null
  stalledDays: number
}): { signals: string[]; score: number } {
  const { issue } = input
  const signals: string[] = []

  if (issue.storyPoints == null) signals.push('sem estimativa')
  if (input.rejectionsInWindow >= 1) {
    signals.push(`reprovado ${input.rejectionsInWindow}x na sprint`)
  }
  if (input.daysSinceLastActivity != null && input.daysSinceLastActivity >= input.stalledDays) {
    signals.push(`sem atividade há ${input.daysSinceLastActivity} dias`)
  }
  if (input.daysInCurrentStatus != null && input.daysInCurrentStatus >= 5) {
    signals.push(`há ${input.daysInCurrentStatus} dias em ${issue.status ?? 'status atual'}`)
  }
  if (issue.flagged) signals.push('sinalizado (impedimento)')

  return { signals, score: signals.length }
}

interface RiskDerivation {
  daysInCurrentStatus: number | null
  rejectionsInWindow: number
  daysSinceLastActivity: number | null
}

/**
 * Radar de risco da sprint ativa: cards NÃO concluídos do escopo com pelo menos
 * um sinal, ordenados por score DESC e depois por inatividade DESC.
 */
export function buildSprintRisk(
  ctx: { db: Database.Database; workspaceId: number; accountId: string; siteUrl: string },
  stalledDays: number
): { sprint: { jiraId: number; name: string } | null; items: RiskItem[] } {
  const { db, workspaceId, accountId, siteUrl } = ctx
  const sprint = getActiveSprint(db, workspaceId)
  if (!sprint) return { sprint: null, items: [] }

  const sprintStart = sprint.startDate ?? '1970-01-01'
  const scope = queryIssues(
    { db, workspaceId, accountId, siteUrl },
    { start: sprintStart, end: new Date().toISOString(), bucket: 'sprintScope', stalledDays }
  ).filter((i) => i.statusCategory !== 'done')

  const lastStatusStmt = db.prepare(
    `SELECT MAX(occurred_at) AS at FROM issue_activity
     WHERE workspace_id = ? AND issue_key = ? AND kind = 'status_change'`
  )
  const lastActivityStmt = db.prepare(
    `SELECT MAX(occurred_at) AS at FROM issue_activity
     WHERE workspace_id = ? AND issue_key = ?`
  )
  const rejectionsStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM issue_activity
     WHERE workspace_id = ? AND issue_key = ? AND kind = 'status_change'
       AND occurred_at >= ?
       AND (LOWER(to_value) LIKE '%reprov%' OR LOWER(to_value) LIKE '%rejeit%'
            OR LOWER(to_value) LIKE '%reject%')`
  )

  const now = Date.now()
  const daysSince = (iso: string | null): number | null =>
    iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : null

  const ranked: Array<RiskItem & { inactivity: number }> = []
  for (const issue of scope) {
    const lastStatus = (lastStatusStmt.get(workspaceId, issue.key) as { at: string | null }).at
    const lastActivity = (lastActivityStmt.get(workspaceId, issue.key) as { at: string | null }).at
    const rejections = (rejectionsStmt.get(workspaceId, issue.key, sprintStart) as { c: number }).c

    const derivation: RiskDerivation = {
      daysInCurrentStatus: daysSince(lastStatus),
      rejectionsInWindow: rejections,
      daysSinceLastActivity: daysSince(lastActivity)
    }

    const { signals, score } = computeRiskSignals({ issue, ...derivation, stalledDays })
    if (score >= 1) {
      ranked.push({ issue, signals, score, inactivity: derivation.daysSinceLastActivity ?? -1 })
    }
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.inactivity - a.inactivity
  })

  const items: RiskItem[] = ranked.map(({ issue, signals, score }) => ({ issue, signals, score }))
  return { sprint: { jiraId: sprint.jiraId, name: sprint.name ?? 'Sprint' }, items }
}
