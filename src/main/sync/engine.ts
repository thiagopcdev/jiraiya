import type Database from 'better-sqlite3'
import { JiraClient } from '../jira/client'
import { buildSyncJql } from '../jira/jql'
import { deriveActivities } from './deriveActivities'
import { mapIssue } from './mapIssue'
import { insertActivities } from '../db/repos/activity'
import { issuesNeedingChangelog, markChangelogSynced, upsertIssue } from '../db/repos/issue'
import { getPrefs, getSyncCursor, setSyncState } from '../db/repos/misc'
import { listBoards, selectedProjectKeys, upsertSprints } from '../db/repos/catalog'
import type { JiraIssue } from '../jira/types'

export interface SyncProgress {
  phase: string
  done: number
  total: number | null
}

export interface SyncDeps {
  db: Database.Database
  client: JiraClient
  workspace: {
    id: number
    time_zone: string | null
    story_points_field_id: string | null
    sprint_field_id: string | null
  }
  onProgress?: (p: SyncProgress) => void
  /** Hook pós-sync (alertas, notificações) */
  onAfterSync?: () => void
}

export interface SyncResult {
  issuesProcessed: number
  activitiesIssues: number
}

const RESOURCE = 'issues'

export async function runSync(deps: SyncDeps, opts: { full?: boolean } = {}): Promise<SyncResult> {
  const { db, client, workspace, onProgress } = deps
  const prefs = getPrefs(db)
  const fieldIds = {
    storyPointsFieldId: workspace.story_points_field_id,
    sprintFieldId: workspace.sprint_field_id
  }

  setSyncState(db, workspace.id, RESOURCE, { status: 'running', error: null })

  try {
    const cursor = opts.full ? null : getSyncCursor(db, workspace.id, RESOURCE)
    const jql = buildSyncJql({
      mode: prefs.syncMode,
      projectKeys: selectedProjectKeys(db, workspace.id),
      cursor,
      backfillDays: prefs.backfillDays,
      timeZone: workspace.time_zone
    })

    // fase 1: issues
    onProgress?.({ phase: 'issues', done: 0, total: null })
    const changedKeys: string[] = []
    const idToKey = new Map<string, string>()
    let processed = 0

    await client.searchAll(jql, compactFieldIds(fieldIds), async (page: JiraIssue[]) => {
      const tx = db.transaction(() => {
        for (const raw of page) {
          upsertIssue(db, workspace.id, mapIssue(raw, fieldIds))
          idToKey.set(raw.id, raw.key)
        }
      })
      tx()
      const pageKeys = page.map((i) => i.key)
      changedKeys.push(...issuesNeedingChangelog(db, workspace.id, pageKeys))
      processed += page.length
      onProgress?.({ phase: 'issues', done: processed, total: null })

      // avança o cursor por página (crash-safe): máx updated totalmente processado
      const maxUpdated = page[page.length - 1]?.fields.updated
      if (maxUpdated) {
        setSyncState(db, workspace.id, RESOURCE, {
          cursor: new Date(maxUpdated).toISOString(),
          status: 'running'
        })
      }
    })

    // fase 2: changelogs + comentários -> activities
    onProgress?.({ phase: 'activities', done: 0, total: changedKeys.length })
    const changelogsByIssueId = await client.bulkChangelogs(changedKeys)
    let activitiesDone = 0

    for (const key of changedKeys) {
      const raw = rawIssueByKey(db, workspace.id, key)
      if (!raw) continue
      const issueId = raw.jira_id
      const changelog = changelogsByIssueId.get(issueId) ?? changelogsByIssueId.get(key) ?? []
      const comments = await client.issueComments(key)
      const activities = deriveActivities({
        issue: {
          key,
          fields: {
            summary: raw.summary,
            created: raw.created_at ?? undefined,
            reporter: raw.reporter_account_id ? { accountId: raw.reporter_account_id } : null
          }
        },
        changelog,
        comments,
        storyPointsFieldId: workspace.story_points_field_id
      })
      insertActivities(db, workspace.id, activities)
      markChangelogSynced(db, workspace.id, key)
      activitiesDone++
      if (activitiesDone % 10 === 0 || activitiesDone === changedKeys.length) {
        onProgress?.({ phase: 'activities', done: activitiesDone, total: changedKeys.length })
      }
    }

    // fase 3: sprints dos boards conhecidos
    onProgress?.({ phase: 'sprints', done: 0, total: null })
    const boards = listBoards(db, workspace.id)
    for (const board of boards) {
      const sprints = await client.listSprints(board.jiraId)
      upsertSprints(
        db,
        workspace.id,
        sprints.map((s) => ({
          jiraId: s.id,
          boardJiraId: s.originBoardId ?? board.jiraId,
          name: s.name ?? null,
          state: s.state ?? null,
          startDate: s.startDate ? new Date(s.startDate).toISOString() : null,
          endDate: s.endDate ? new Date(s.endDate).toISOString() : null,
          completeDate: s.completeDate ? new Date(s.completeDate).toISOString() : null
        }))
      )
    }

    setSyncState(db, workspace.id, RESOURCE, { status: 'idle', success: true, error: null })
    deps.onAfterSync?.()
    return { issuesProcessed: processed, activitiesIssues: activitiesDone }
  } catch (err) {
    setSyncState(db, workspace.id, RESOURCE, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

function compactFieldIds(fieldIds: {
  storyPointsFieldId: string | null
  sprintFieldId: string | null
}): string[] {
  return [fieldIds.storyPointsFieldId, fieldIds.sprintFieldId].filter(
    (id): id is string => id !== null
  )
}

interface RawIssueRow {
  jira_id: string
  summary: string
  created_at: string | null
  reporter_account_id: string | null
}

function rawIssueByKey(
  db: Database.Database,
  workspaceId: number,
  key: string
): RawIssueRow | null {
  return (
    (db
      .prepare(
        'SELECT jira_id, summary, created_at, reporter_account_id FROM issue WHERE workspace_id = ? AND key = ?'
      )
      .get(workspaceId, key) as RawIssueRow | undefined) ?? null
  )
}
