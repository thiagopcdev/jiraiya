import type Database from 'better-sqlite3'
import type { Prefs } from '@shared/domain'
import { DEFAULT_PREFS } from '@shared/domain'
import { getPrefs, setPrefs } from './db/repos/misc'

/**
 * Backup/restauração dos dados LOCAIS do Jiraiya (nada que venha do Jira).
 *
 * O arquivo é JSON legível e versionado. O import é sempre MERGE: nada é
 * apagado, itens já existentes por chave/nome são preservados ou atualizados.
 */

export interface BackupData {
  app: 'jiraiya'
  backupVersion: 1
  exportedAt: string
  siteUrl: string
  prefs: Prefs
  notes: Array<{ issueKey: string; content: string; updatedAt: string }>
  /** chaves dos cards seguidos */
  watches: string[]
  filters: Array<{ name: string; jql: string; position: number }>
  templates: Array<{ name: string; content: string; position: number }>
}

export interface ImportCounts {
  notes: number
  watches: number
  filters: number
  templates: number
  prefs: boolean
}

export function buildBackup(
  db: Database.Database,
  workspace: { id: number; site_url: string },
  now: string
): BackupData {
  const notes = db
    .prepare(
      `SELECT issue_key, content, updated_at FROM issue_note
       WHERE workspace_id = ? ORDER BY issue_key`
    )
    .all(workspace.id) as Array<{ issue_key: string; content: string; updated_at: string }>

  const watches = db
    .prepare(`SELECT issue_key FROM watch WHERE workspace_id = ? ORDER BY created_at, id`)
    .all(workspace.id) as Array<{ issue_key: string }>

  const filters = db
    .prepare(
      `SELECT name, jql, position FROM jql_filter WHERE workspace_id = ? ORDER BY position, id`
    )
    .all(workspace.id) as Array<{ name: string; jql: string; position: number }>

  const templates = db
    .prepare(
      `SELECT name, content, position FROM comment_template
       WHERE workspace_id = ? ORDER BY position, id`
    )
    .all(workspace.id) as Array<{ name: string; content: string; position: number }>

  return {
    app: 'jiraiya',
    backupVersion: 1,
    exportedAt: now,
    siteUrl: workspace.site_url,
    prefs: getPrefs(db),
    notes: notes.map((n) => ({
      issueKey: n.issue_key,
      content: n.content,
      updatedAt: n.updated_at
    })),
    watches: watches.map((w) => w.issue_key),
    filters: filters.map((f) => ({ name: f.name, jql: f.jql, position: f.position })),
    templates: templates.map((t) => ({ name: t.name, content: t.content, position: t.position }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Só as chaves conhecidas de DEFAULT_PREFS cujo tipo bate com o default. */
function prefsPatch(raw: unknown): Partial<Prefs> {
  if (!isRecord(raw)) return {}
  const patch: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(DEFAULT_PREFS)) {
    if (!(key in raw)) continue
    const value = raw[key]
    if (typeof value === typeof def) patch[key] = value
  }
  return patch as Partial<Prefs>
}

/**
 * Aplica um backup no workspace atual (MERGE). Itens malformados são ignorados
 * individualmente — só o envelope inválido lança.
 */
export function applyBackup(
  db: Database.Database,
  workspaceId: number,
  raw: unknown
): ImportCounts {
  if (!isRecord(raw) || raw.app !== 'jiraiya' || raw.backupVersion !== 1) {
    throw new Error('Arquivo não é um backup válido do Jiraiya')
  }

  const counts: ImportCounts = { notes: 0, watches: 0, filters: 0, templates: 0, prefs: false }
  const now = new Date().toISOString()

  const upsertNote = db.prepare(
    `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, issue_key) DO UPDATE SET
       content = excluded.content, updated_at = excluded.updated_at`
  )
  const insertWatch = db.prepare(
    `INSERT OR IGNORE INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
     VALUES (?, ?, NULL, NULL, ?)`
  )
  const filterExists = db.prepare(
    'SELECT 1 AS one FROM jql_filter WHERE workspace_id = ? AND name = ?'
  )
  const insertFilter = db.prepare(
    `INSERT INTO jql_filter (workspace_id, name, jql, position, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const templateExists = db.prepare(
    'SELECT 1 AS one FROM comment_template WHERE workspace_id = ? AND name = ?'
  )
  const insertTemplate = db.prepare(
    `INSERT INTO comment_template (workspace_id, name, content, position, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )

  const apply = db.transaction(() => {
    for (const item of asArray(raw.notes)) {
      if (!isRecord(item)) continue
      const issueKey = nonEmptyString(item.issueKey)
      if (!issueKey) continue
      if (typeof item.content !== 'string' || item.content.trim() === '') continue
      const updatedAt = nonEmptyString(item.updatedAt) ?? now
      const info = upsertNote.run(workspaceId, issueKey, item.content, updatedAt)
      if (info.changes > 0) counts.notes++
    }

    for (const item of asArray(raw.watches)) {
      const issueKey = nonEmptyString(item)
      if (!issueKey) continue
      const info = insertWatch.run(workspaceId, issueKey, now)
      if (info.changes > 0) counts.watches++
    }

    for (const item of asArray(raw.filters)) {
      if (!isRecord(item)) continue
      const name = nonEmptyString(item.name)
      const jql = nonEmptyString(item.jql)
      if (!name || !jql) continue
      if (filterExists.get(workspaceId, name) !== undefined) continue
      const position = typeof item.position === 'number' ? item.position : 0
      insertFilter.run(workspaceId, name, jql, position, now)
      counts.filters++
    }

    for (const item of asArray(raw.templates)) {
      if (!isRecord(item)) continue
      const name = nonEmptyString(item.name)
      const content = nonEmptyString(item.content)
      if (!name || !content) continue
      if (templateExists.get(workspaceId, name) !== undefined) continue
      const position = typeof item.position === 'number' ? item.position : 0
      insertTemplate.run(workspaceId, name, content, position, now)
      counts.templates++
    }

    if (isRecord(raw.prefs)) {
      setPrefs(db, prefsPatch(raw.prefs))
      counts.prefs = true
    }
  })
  apply()

  return counts
}
