import type Database from 'better-sqlite3'
import type { Issue, StatusCategory } from '@shared/domain'

export interface IssueUpsert {
  jiraId: string
  key: string
  projectKey: string
  summary: string
  descriptionText: string | null
  issueType: string | null
  status: string | null
  statusCategory: string | null
  priority: string | null
  assigneeAccountId: string | null
  assigneeName: string | null
  reporterAccountId: string | null
  storyPoints: number | null
  sprintJiraId: number | null
  labels: string[]
  parentKey: string | null
  flagged: boolean
  createdAt: string | null
  updatedAt: string | null
  resolvedAt: string | null
}

export interface IssueRow {
  id: number
  jira_id: string
  key: string
  project_key: string
  summary: string
  description_text: string | null
  issue_type: string | null
  status: string | null
  status_category: string | null
  priority: string | null
  assignee_account_id: string | null
  assignee_name: string | null
  reporter_account_id: string | null
  story_points: number | null
  sprint_jira_id: number | null
  labels_json: string
  parent_key: string | null
  flagged: number
  created_at: string | null
  updated_at: string | null
  resolved_at: string | null
  changelog_synced_at: string | null
}

export function rowToIssue(row: IssueRow, siteUrl: string): Issue {
  return {
    jiraId: row.jira_id,
    key: row.key,
    projectKey: row.project_key,
    summary: row.summary,
    descriptionText: row.description_text,
    issueType: row.issue_type,
    status: row.status,
    statusCategory: (row.status_category as StatusCategory | null) ?? null,
    priority: row.priority,
    assigneeAccountId: row.assignee_account_id,
    assigneeName: row.assignee_name,
    reporterAccountId: row.reporter_account_id,
    storyPoints: row.story_points,
    sprintJiraId: row.sprint_jira_id,
    labels: JSON.parse(row.labels_json) as string[],
    parentKey: row.parent_key,
    flagged: row.flagged === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    url: `${siteUrl.replace(/\/$/, '')}/browse/${row.key}`
  }
}

export function upsertIssue(db: Database.Database, workspaceId: number, i: IssueUpsert): void {
  db.prepare(
    `INSERT INTO issue (
      workspace_id, jira_id, key, project_key, summary, description_text, issue_type,
      status, status_category, priority, assignee_account_id, assignee_name,
      reporter_account_id, story_points, sprint_jira_id, labels_json, parent_key,
      flagged, created_at, updated_at, resolved_at, last_synced_at
    ) VALUES (
      @workspaceId, @jiraId, @key, @projectKey, @summary, @descriptionText, @issueType,
      @status, @statusCategory, @priority, @assigneeAccountId, @assigneeName,
      @reporterAccountId, @storyPoints, @sprintJiraId, @labelsJson, @parentKey,
      @flagged, @createdAt, @updatedAt, @resolvedAt, @now
    )
    ON CONFLICT(workspace_id, key) DO UPDATE SET
      jira_id=excluded.jira_id, project_key=excluded.project_key, summary=excluded.summary,
      description_text=excluded.description_text, issue_type=excluded.issue_type,
      status=excluded.status, status_category=excluded.status_category, priority=excluded.priority,
      assignee_account_id=excluded.assignee_account_id, assignee_name=excluded.assignee_name,
      reporter_account_id=excluded.reporter_account_id, story_points=excluded.story_points,
      sprint_jira_id=excluded.sprint_jira_id, labels_json=excluded.labels_json,
      parent_key=excluded.parent_key, flagged=excluded.flagged,
      created_at=excluded.created_at, updated_at=excluded.updated_at,
      resolved_at=excluded.resolved_at, last_synced_at=excluded.last_synced_at`
  ).run({
    workspaceId,
    jiraId: i.jiraId,
    key: i.key,
    projectKey: i.projectKey,
    summary: i.summary,
    descriptionText: i.descriptionText,
    issueType: i.issueType,
    status: i.status,
    statusCategory: i.statusCategory,
    priority: i.priority,
    assigneeAccountId: i.assigneeAccountId,
    assigneeName: i.assigneeName,
    reporterAccountId: i.reporterAccountId,
    storyPoints: i.storyPoints,
    sprintJiraId: i.sprintJiraId,
    labelsJson: JSON.stringify(i.labels),
    parentKey: i.parentKey,
    flagged: i.flagged ? 1 : 0,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    resolvedAt: i.resolvedAt,
    now: new Date().toISOString()
  })
}

export function getIssueByKey(
  db: Database.Database,
  workspaceId: number,
  key: string
): IssueRow | null {
  return (
    (db.prepare('SELECT * FROM issue WHERE workspace_id = ? AND key = ?').get(workspaceId, key) as
      IssueRow | undefined) ?? null
  )
}

/** Subtarefas/filhos de um card (issues cujo parent_key aponta para ele). */
export function listChildIssues(
  db: Database.Database,
  workspaceId: number,
  parentKey: string,
  siteUrl: string
): Issue[] {
  const rows = db
    .prepare('SELECT * FROM issue WHERE workspace_id = ? AND parent_key = ? ORDER BY key')
    .all(workspaceId, parentKey) as IssueRow[]
  return rows.map((r) => rowToIssue(r, siteUrl))
}

/** Issues cujo changelog está desatualizado em relação ao updated do Jira. */
export function issuesNeedingChangelog(
  db: Database.Database,
  workspaceId: number,
  keys: string[]
): string[] {
  if (keys.length === 0) return []
  const placeholders = keys.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT key FROM issue
       WHERE workspace_id = ? AND key IN (${placeholders})
         AND (changelog_synced_at IS NULL OR updated_at > changelog_synced_at)`
    )
    .all(workspaceId, ...keys) as Array<{ key: string }>
  return rows.map((r) => r.key)
}

/** Atualiza status/categoria de um card localmente (após transição no Jira). */
export function updateIssueStatus(
  db: Database.Database,
  workspaceId: number,
  key: string,
  status: string,
  statusCategory: StatusCategory
): void {
  db.prepare(
    `UPDATE issue SET status = ?, status_category = ?, updated_at = ?
     WHERE workspace_id = ? AND key = ?`
  ).run(status, statusCategory, new Date().toISOString(), workspaceId, key)
}

/**
 * Atualiza campos editados de um card localmente (após edição no Jira).
 * UPDATE dinâmico só das colunas presentes no patch. Patch vazio → no-op.
 */
export function updateIssueFields(
  db: Database.Database,
  workspaceId: number,
  key: string,
  patch: {
    storyPoints?: number | null
    priority?: string
    assigneeAccountId?: string | null
    assigneeName?: string | null
  }
): void {
  const sets: string[] = []
  const values: Array<number | string | null> = []
  if (patch.storyPoints !== undefined) {
    sets.push('story_points = ?')
    values.push(patch.storyPoints)
  }
  if (patch.priority !== undefined) {
    sets.push('priority = ?')
    values.push(patch.priority)
  }
  if (patch.assigneeAccountId !== undefined) {
    sets.push('assignee_account_id = ?')
    values.push(patch.assigneeAccountId)
  }
  if (patch.assigneeName !== undefined) {
    sets.push('assignee_name = ?')
    values.push(patch.assigneeName)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  values.push(new Date().toISOString())
  db.prepare(`UPDATE issue SET ${sets.join(', ')} WHERE workspace_id = ? AND key = ?`).run(
    ...values,
    workspaceId,
    key
  )
}

export function markChangelogSynced(db: Database.Database, workspaceId: number, key: string): void {
  db.prepare(
    `UPDATE issue SET changelog_synced_at = updated_at WHERE workspace_id = ? AND key = ?`
  ).run(workspaceId, key)
}
