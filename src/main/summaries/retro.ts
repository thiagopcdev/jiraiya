import type Database from 'better-sqlite3'

export interface RetroCtx {
  db: Database.Database
  workspaceId: number
  accountId: string
}

export interface RetroDigest {
  sprint: {
    jiraId: number
    name: string | null
    state: 'active' | 'closed'
    startDate: string
    endDate: string
  }
  myDone: Array<{ key: string; summary: string; storyPoints: number | null }>
  teamTotals: { points: number; cards: number }
  myTotals: { points: number; cards: number }
  /** status_change com to_value ~ reprov/rejeit na janela */
  rejectedCount: number
  /** cards da sprint (sprint_jira_id) ainda não concluídos */
  openAtEnd: number
}

// EXISTS reutilizado: "meu" = assignee atual OU autor da atividade `resolved`.
const MINE_CLAUSE = `(i.assignee_account_id = @accountId OR EXISTS (
  SELECT 1 FROM issue_activity a
  WHERE a.workspace_id = i.workspace_id AND a.issue_key = i.key
    AND a.actor_account_id = @accountId AND a.kind = 'resolved'
))`

interface SprintRow {
  jira_id: number
  name: string | null
  state: string
  start_date: string | null
  end_date: string | null
  complete_date: string | null
}

/**
 * Monta o digest determinístico de uma sprint. Janela temporal idêntica à
 * velocity: `[start_date, complete_date ?? end_date ?? agora)`. Retorna null se
 * a sprint não existe ou não tem `start_date`.
 */
export function buildRetroDigest(ctx: RetroCtx, sprintJiraId: number): RetroDigest | null {
  const { db, workspaceId, accountId } = ctx
  const s = db
    .prepare(
      `SELECT jira_id, name, state, start_date, end_date, complete_date
       FROM sprint WHERE workspace_id = ? AND jira_id = ?`
    )
    .get(workspaceId, sprintJiraId) as SprintRow | undefined
  if (!s || !s.start_date) return null

  const start = s.start_date
  const end = s.complete_date ?? s.end_date ?? new Date().toISOString()

  const teamRow = db
    .prepare(
      `SELECT COUNT(*) AS cards, COALESCE(SUM(COALESCE(story_points, 0)), 0) AS points
       FROM issue i
       WHERE i.workspace_id = @workspaceId
         AND i.resolved_at IS NOT NULL
         AND i.resolved_at >= @start AND i.resolved_at < @end`
    )
    .get({ workspaceId, start, end }) as { cards: number; points: number }

  const myRow = db
    .prepare(
      `SELECT COUNT(*) AS cards, COALESCE(SUM(COALESCE(story_points, 0)), 0) AS points
       FROM issue i
       WHERE i.workspace_id = @workspaceId
         AND i.resolved_at IS NOT NULL
         AND i.resolved_at >= @start AND i.resolved_at < @end
         AND ${MINE_CLAUSE}`
    )
    .get({ workspaceId, accountId, start, end }) as { cards: number; points: number }

  const myDoneRows = db
    .prepare(
      `SELECT key, summary, story_points FROM issue i
       WHERE i.workspace_id = @workspaceId
         AND i.resolved_at IS NOT NULL
         AND i.resolved_at >= @start AND i.resolved_at < @end
         AND ${MINE_CLAUSE}
       ORDER BY i.resolved_at ASC`
    )
    .all({ workspaceId, accountId, start, end }) as Array<{
    key: string
    summary: string
    story_points: number | null
  }>

  const rejected = db
    .prepare(
      `SELECT COUNT(*) AS n FROM issue_activity
       WHERE workspace_id = @workspaceId AND kind = 'status_change'
         AND occurred_at >= @start AND occurred_at < @end
         AND (
           LOWER(to_value) LIKE '%reprov%' OR LOWER(to_value) LIKE '%rejeit%'
           OR LOWER(to_value) LIKE '%reject%'
         )`
    )
    .get({ workspaceId, start, end }) as { n: number }

  const open = db
    .prepare(
      `SELECT COUNT(*) AS n FROM issue
       WHERE workspace_id = ? AND sprint_jira_id = ?
         AND (status_category IS NULL OR status_category != 'done')`
    )
    .get(workspaceId, sprintJiraId) as { n: number }

  return {
    sprint: {
      jiraId: s.jira_id,
      name: s.name,
      state: s.state === 'active' ? 'active' : 'closed',
      startDate: start,
      endDate: end
    },
    myDone: myDoneRows.map((r) => ({
      key: r.key,
      summary: r.summary,
      storyPoints: r.story_points
    })),
    teamTotals: { points: teamRow.points, cards: teamRow.cards },
    myTotals: { points: myRow.points, cards: myRow.cards },
    rejectedCount: rejected.n,
    openAtEnd: open.n
  }
}

const dateOnly = (iso: string): string => iso.slice(0, 10)

/** Markdown pt-BR determinístico da retro (fallback quando não usa IA). */
export function renderRetroTemplate(digest: RetroDigest): string {
  const { sprint, myDone, teamTotals, myTotals, rejectedCount, openAtEnd } = digest
  const lines: string[] = []

  lines.push(`# Retro — ${sprint.name ?? `Sprint ${sprint.jiraId}`}`)
  lines.push('')
  lines.push(`Período: ${dateOnly(sprint.startDate)} a ${dateOnly(sprint.endDate)}`)
  lines.push('')
  lines.push('## Números')
  lines.push(`- Story points do time: ${teamTotals.points}`)
  lines.push(`- Story points meus: ${myTotals.points}`)
  lines.push(`- Cards concluídos (time): ${teamTotals.cards}`)
  lines.push(`- Cards concluídos (meus): ${myTotals.cards}`)
  lines.push(`- Reprovações no período: ${rejectedCount}`)
  lines.push(`- Cards ainda em aberto na sprint: ${openAtEnd}`)
  lines.push('')
  lines.push('## O que eu entreguei')
  if (myDone.length === 0) {
    lines.push('- Nenhum card concluído por mim no período.')
  } else {
    for (const c of myDone) {
      const sp = c.storyPoints ?? '?'
      lines.push(`- ${c.key} — ${c.summary} (${sp} SP)`)
    }
  }

  return lines.join('\n')
}
