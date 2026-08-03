import type Database from 'better-sqlite3'
import { JiraClient } from '../jira/client'
import { buildSyncJql } from '../jira/jql'
import { deriveActivities } from './deriveActivities'
import { mapIssue } from './mapIssue'
import { insertActivities } from '../db/repos/activity'
import {
  allIssueKeys,
  getIssueByKey,
  issuesNeedingChangelog,
  markChangelogSynced,
  purgeIssue,
  upsertIssue
} from '../db/repos/issue'
import { isMaybeIssueGoneError } from '../issues/gone'
import { isFreshAssignmentToMe } from './assignment'
import { extractMentions } from './mentions'
import { insertMentions } from '../db/repos/mentions'
import { getPrefs, getSyncCursor, setSyncState } from '../db/repos/misc'
import {
  listBoards,
  pruneBoards,
  selectedProjectKeys,
  upsertBoards,
  upsertSprints
} from '../db/repos/catalog'
import { setWorkspaceFields } from '../db/repos/workspace'
import { discoverCustomFields } from '../jira/client'
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
    account_id: string
    time_zone: string | null
    story_points_field_id: string | null
    sprint_field_id: string | null
    flagged_field_id: string | null
  }
  onProgress?: (p: SyncProgress) => void
  /** Hook pós-sync (alertas, notificações) */
  onAfterSync?: (info: AfterSyncInfo) => void
}

export interface AfterSyncInfo {
  /** cards que passaram a ser atribuídos a mim nesta rodada */
  assignedToMe: Array<{ key: string; summary: string }>
  /** menções novas a mim nesta rodada (exceto auto-menção e primeiro sync) */
  newMentions: Array<{ issueKey: string; authorName: string | null; excerpt: string | null }>
}

export interface SyncResult {
  issuesProcessed: number
  activitiesIssues: number
  /** cards que não existem mais no Jira e saíram do cache nesta rodada */
  purgedIssues: string[]
}

const RESOURCE = 'issues'

export async function runSync(deps: SyncDeps, opts: { full?: boolean } = {}): Promise<SyncResult> {
  const { db, client, workspace, onProgress } = deps
  const prefs = getPrefs(db)

  // workspaces conectados antes da migration 002 não têm o flagged field
  // descoberto — descobre uma única vez ('none' = procurado e ausente)
  if (workspace.flagged_field_id === null) {
    const discovered = discoverCustomFields(await client.listFields())
    workspace.flagged_field_id = discovered.flaggedFieldId ?? 'none'
    setWorkspaceFields(db, workspace.id, { flaggedFieldId: workspace.flagged_field_id })
  }

  const fieldIds = {
    storyPointsFieldId: workspace.story_points_field_id,
    sprintFieldId: workspace.sprint_field_id,
    flaggedFieldId: workspace.flagged_field_id === 'none' ? null : workspace.flagged_field_id
  }

  setSyncState(db, workspace.id, RESOURCE, { status: 'running', error: null })

  try {
    const cursor = opts.full ? null : getSyncCursor(db, workspace.id, RESOURCE)
    const isFirstSync = cursor === null
    const assignedToMe: Array<{ key: string; summary: string }> = []
    const newMentions: AfterSyncInfo['newMentions'] = []
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
          const mapped = mapIssue(raw, fieldIds)
          const existing = getIssueByKey(db, workspace.id, raw.key)
          if (
            isFreshAssignmentToMe({
              previousAssignee: existing?.assignee_account_id,
              newAssignee: mapped.assigneeAccountId,
              myAccountId: workspace.account_id,
              isFirstSync
            })
          ) {
            assignedToMe.push({ key: raw.key, summary: mapped.summary })
          }
          upsertIssue(db, workspace.id, mapped)
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

    // fase 1.5 (só no sync completo): cards excluídos no Jira. A busca
    // incremental nunca devolve quem foi apagado, então sem essa reconciliação o
    // card fantasma fica no cache para sempre. É bulkfetch em lotes de 100, por
    // isso roda apenas no sync completo (o incremental segue barato).
    const purged: string[] = []
    if (opts.full) {
      const localKeys = allIssueKeys(db, workspace.id)
      if (localKeys.length > 0) {
        onProgress?.({ phase: 'reconcile', done: 0, total: localKeys.length })
        try {
          for (const key of await client.missingIssueKeys(localKeys)) {
            if (purgeIssue(db, workspace.id, key)) purged.push(key)
          }
        } catch {
          // reconciliação é oportunista: falha aqui não derruba o sync
        }
        onProgress?.({ phase: 'reconcile', done: localKeys.length, total: localKeys.length })
      }
    }

    // fase 2: changelogs + comentários -> activities.
    // Além das issues desta rodada, recupera pendências de rodadas que
    // falharam no meio (issue gravada, activity não derivada).
    const pendingRows = db
      .prepare(
        `SELECT key FROM issue
         WHERE workspace_id = ? AND (changelog_synced_at IS NULL OR updated_at > changelog_synced_at)`
      )
      .all(workspace.id) as Array<{ key: string }>
    for (const { key } of pendingRows) {
      if (!changedKeys.includes(key)) changedKeys.push(key)
    }

    onProgress?.({ phase: 'activities', done: 0, total: changedKeys.length })
    const changelogsByIssueId = await client.bulkChangelogs(changedKeys)
    let activitiesDone = 0

    for (const key of changedKeys) {
      const raw = rawIssueByKey(db, workspace.id, key)
      if (!raw) continue
      const issueId = raw.jira_id
      // fallback: issue ausente do bulk (changelog gigante ou não retornado) e
      // que teve mudanças (updated != created) -> pagina por issue
      let changelog = changelogsByIssueId.get(issueId) ?? changelogsByIssueId.get(key) ?? null
      if (changelog === null) {
        const hadChanges =
          raw.updated_at !== null && raw.created_at !== null && raw.updated_at !== raw.created_at
        changelog = hadChanges ? await client.issueChangelog(key).catch(() => []) : []
      }
      // card apagado no Jira entre a busca e agora: 404 aqui derrubava o sync
      // inteiro — purga e segue para o próximo
      let comments: Awaited<ReturnType<typeof client.issueComments>>
      try {
        comments = await client.issueComments(key)
      } catch (err) {
        if (!isMaybeIssueGoneError(err)) throw err
        if (purgeIssue(db, workspace.id, key)) purged.push(key)
        continue
      }
      const mentions = extractMentions({
        issueKey: key,
        comments,
        myAccountId: workspace.account_id
      })
      const insertedMentions = insertMentions(db, workspace.id, mentions, {
        markRead: isFirstSync
      })
      if (!isFirstSync) {
        for (const m of insertedMentions) {
          if (m.authorAccountId !== workspace.account_id) {
            newMentions.push({
              issueKey: m.issueKey,
              authorName: m.authorName,
              excerpt: m.excerpt
            })
          }
        }
      }
      const activities = deriveActivities({
        issue: {
          key,
          fields: {
            summary: raw.summary,
            created: raw.created_at ?? undefined,
            reporter: raw.reporter_account_id
              ? { accountId: raw.reporter_account_id, displayName: raw.reporter_name ?? undefined }
              : null
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

    // fase 3: boards dos projetos selecionados + sprints. O refresh aqui é o
    // que faz quadros criados no Jira depois da configuração aparecerem (a
    // seleção de projetos só descobre boards no momento do setSelected).
    onProgress?.({ phase: 'sprints', done: 0, total: null })
    for (const projectKey of selectedProjectKeys(db, workspace.id)) {
      try {
        const remote = await client.listBoards(projectKey)
        upsertBoards(
          db,
          workspace.id,
          remote.map((b) => ({
            jiraId: b.id,
            name: b.name ?? null,
            type: b.type ?? null,
            projectKey: b.location?.projectKey ?? projectKey
          }))
        )
        pruneBoards(
          db,
          workspace.id,
          projectKey,
          remote.map((b) => b.id)
        )
      } catch {
        // projeto sem board (ex.: service desk) ou falha pontual — usa o cache
      }
    }
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
    deps.onAfterSync?.({ assignedToMe, newMentions })
    return { issuesProcessed: processed, activitiesIssues: activitiesDone, purgedIssues: purged }
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
  flaggedFieldId: string | null
}): string[] {
  return [fieldIds.storyPointsFieldId, fieldIds.sprintFieldId, fieldIds.flaggedFieldId].filter(
    (id): id is string => id !== null
  )
}

interface RawIssueRow {
  jira_id: string
  summary: string
  created_at: string | null
  updated_at: string | null
  reporter_account_id: string | null
  reporter_name: string | null
}

function rawIssueByKey(
  db: Database.Database,
  workspaceId: number,
  key: string
): RawIssueRow | null {
  return (
    (db
      .prepare(
        'SELECT jira_id, summary, created_at, updated_at, reporter_account_id, reporter_name FROM issue WHERE workspace_id = ? AND key = ?'
      )
      .get(workspaceId, key) as RawIssueRow | undefined) ?? null
  )
}
