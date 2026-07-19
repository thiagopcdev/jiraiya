import type Database from 'better-sqlite3'
import { rules, type AlertSnapshot } from './rules'
import { lastActivityPerIssue } from '../db/repos/activity'
import { getActiveSprint } from '../db/repos/catalog'
import { getWorkspaceRow } from '../db/repos/workspace'
import { getPrefs, reconcileAlerts, listActiveAlerts } from '../db/repos/misc'

/** Roda todas as regras sobre o snapshot atual e reconcilia a tabela de alertas. */
export function runAlertEngine(
  db: Database.Database,
  workspaceId: number
): { activeCount: number } {
  const openIssues = db
    .prepare(
      `SELECT key, summary, issue_type, status, status_category, priority,
              assignee_account_id, description_text, story_points, sprint_jira_id,
              flagged, updated_at
       FROM issue
       WHERE workspace_id = ? AND (status_category IS NULL OR status_category != 'done')`
    )
    .all(workspaceId) as Array<{
    key: string
    summary: string
    issue_type: string | null
    status: string | null
    status_category: string | null
    priority: string | null
    assignee_account_id: string | null
    description_text: string | null
    story_points: number | null
    sprint_jira_id: number | null
    flagged: number
    updated_at: string | null
  }>

  const snapshot: AlertSnapshot = {
    openIssues: openIssues.map((r) => ({
      key: r.key,
      summary: r.summary,
      issueType: r.issue_type,
      status: r.status,
      statusCategory: r.status_category,
      priority: r.priority,
      assigneeAccountId: r.assignee_account_id,
      descriptionText: r.description_text,
      storyPoints: r.story_points,
      sprintJiraId: r.sprint_jira_id,
      flagged: r.flagged === 1,
      updatedAt: r.updated_at
    })),
    lastActivityByIssue: lastActivityPerIssue(db, workspaceId),
    activeSprint: getActiveSprint(db, workspaceId),
    stalledDays: getPrefs(db).stalledDays,
    myAccountId: getWorkspaceRow(db)?.account_id ?? '',
    now: new Date()
  }

  const candidates = rules.flatMap((rule) => rule.evaluate(snapshot))
  reconcileAlerts(db, workspaceId, candidates)
  return { activeCount: listActiveAlerts(db, workspaceId).length }
}
