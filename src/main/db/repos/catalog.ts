import type Database from 'better-sqlite3'
import type { Board, Project, Sprint, SprintState } from '@shared/domain'

/** Repos de catálogo: projetos, boards e sprints. */

export function upsertProjects(
  db: Database.Database,
  workspaceId: number,
  projects: Array<{ jiraId: string; key: string; name: string; avatarUrl: string | null }>
): void {
  const stmt = db.prepare(
    `INSERT INTO project (workspace_id, jira_id, key, name, avatar_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, jira_id) DO UPDATE SET key=excluded.key, name=excluded.name, avatar_url=excluded.avatar_url`
  )
  const run = db.transaction(() => {
    for (const p of projects) stmt.run(workspaceId, p.jiraId, p.key, p.name, p.avatarUrl)
  })
  run()
}

export function listProjects(db: Database.Database, workspaceId: number): Project[] {
  const rows = db
    .prepare('SELECT * FROM project WHERE workspace_id = ? ORDER BY key')
    .all(workspaceId) as Array<{
    jira_id: string
    key: string
    name: string
    avatar_url: string | null
    selected: number
  }>
  return rows.map((r) => ({
    jiraId: r.jira_id,
    key: r.key,
    name: r.name,
    avatarUrl: r.avatar_url,
    selected: r.selected === 1
  }))
}

export function setSelectedProjects(
  db: Database.Database,
  workspaceId: number,
  keys: string[]
): void {
  const run = db.transaction(() => {
    db.prepare('UPDATE project SET selected = 0 WHERE workspace_id = ?').run(workspaceId)
    const stmt = db.prepare('UPDATE project SET selected = 1 WHERE workspace_id = ? AND key = ?')
    for (const k of keys) stmt.run(workspaceId, k)
  })
  run()
}

export function selectedProjectKeys(db: Database.Database, workspaceId: number): string[] {
  const rows = db
    .prepare('SELECT key FROM project WHERE workspace_id = ? AND selected = 1 ORDER BY key')
    .all(workspaceId) as Array<{ key: string }>
  return rows.map((r) => r.key)
}

export function upsertBoards(
  db: Database.Database,
  workspaceId: number,
  boards: Array<{
    jiraId: number
    name: string | null
    type: string | null
    projectKey: string | null
  }>
): void {
  const stmt = db.prepare(
    `INSERT INTO board (workspace_id, jira_id, name, type, project_key)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, jira_id) DO UPDATE SET name=excluded.name, type=excluded.type, project_key=excluded.project_key`
  )
  const run = db.transaction(() => {
    for (const b of boards) stmt.run(workspaceId, b.jiraId, b.name, b.type, b.projectKey)
  })
  run()
}

export function listBoards(db: Database.Database, workspaceId: number): Board[] {
  const rows = db
    .prepare('SELECT * FROM board WHERE workspace_id = ? ORDER BY name')
    .all(workspaceId) as Array<{
    jira_id: number
    name: string | null
    type: string | null
    project_key: string | null
  }>
  return rows.map((r) => ({
    jiraId: r.jira_id,
    name: r.name,
    type: r.type,
    projectKey: r.project_key
  }))
}

export function upsertSprints(
  db: Database.Database,
  workspaceId: number,
  sprints: Array<{
    jiraId: number
    boardJiraId: number | null
    name: string | null
    state: string | null
    startDate: string | null
    endDate: string | null
    completeDate: string | null
  }>
): void {
  const stmt = db.prepare(
    `INSERT INTO sprint (workspace_id, jira_id, board_jira_id, name, state, start_date, end_date, complete_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, jira_id) DO UPDATE SET
       board_jira_id=excluded.board_jira_id, name=excluded.name, state=excluded.state,
       start_date=excluded.start_date, end_date=excluded.end_date, complete_date=excluded.complete_date`
  )
  const run = db.transaction(() => {
    for (const s of sprints)
      stmt.run(
        workspaceId,
        s.jiraId,
        s.boardJiraId,
        s.name,
        s.state,
        s.startDate,
        s.endDate,
        s.completeDate
      )
  })
  run()
}

export interface SprintWindowRow {
  jiraId: number
  boardJiraId: number | null
  name: string | null
  state: 'active' | 'closed'
  startDate: string
  endDate: string | null
  completeDate: string | null
}

/**
 * Sprints ativas ou fechadas com data de início, da mais recente para a mais
 * antiga. Exclui `future` e sprints sem `start_date` (não entram no velocity).
 */
export function listRecentSprints(
  db: Database.Database,
  workspaceId: number,
  limit: number
): SprintWindowRow[] {
  const rows = db
    .prepare(
      `SELECT jira_id, board_jira_id, name, state, start_date, end_date, complete_date
       FROM sprint
       WHERE workspace_id = ? AND state IN ('active','closed') AND start_date IS NOT NULL
       ORDER BY start_date DESC LIMIT ?`
    )
    .all(workspaceId, limit) as Array<{
    jira_id: number
    board_jira_id: number | null
    name: string | null
    state: string
    start_date: string
    end_date: string | null
    complete_date: string | null
  }>
  return rows.map((r) => ({
    jiraId: r.jira_id,
    boardJiraId: r.board_jira_id,
    name: r.name,
    state: r.state as 'active' | 'closed',
    startDate: r.start_date,
    endDate: r.end_date,
    completeDate: r.complete_date
  }))
}

export function getActiveSprint(db: Database.Database, workspaceId: number): Sprint | null {
  const r = db
    .prepare(
      `SELECT * FROM sprint WHERE workspace_id = ? AND state = 'active' ORDER BY start_date DESC LIMIT 1`
    )
    .get(workspaceId) as
    | {
        jira_id: number
        board_jira_id: number | null
        name: string | null
        state: string | null
        start_date: string | null
        end_date: string | null
      }
    | undefined
  if (!r) return null
  return {
    jiraId: r.jira_id,
    boardJiraId: r.board_jira_id,
    name: r.name,
    state: r.state as SprintState | null,
    startDate: r.start_date,
    endDate: r.end_date
  }
}
