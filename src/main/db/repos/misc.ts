import type Database from 'better-sqlite3'
import type {
  AiGeneratedBy,
  Alert,
  AlertSeverity,
  Prefs,
  Summary,
  SummaryTemplate
} from '@shared/domain'
import { DEFAULT_PREFS } from '@shared/domain'

/** Repos de summary, alert, sync_state e prefs. */

// ---- summaries ----

export function saveSummary(
  db: Database.Database,
  workspaceId: number,
  s: {
    periodType: string
    periodStart: string
    periodEnd: string
    template: SummaryTemplate
    contentMd: string
    generatedBy: AiGeneratedBy
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO summary (workspace_id, period_type, period_start, period_end, template, content_md, generated_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      s.periodType,
      s.periodStart,
      s.periodEnd,
      s.template,
      s.contentMd,
      s.generatedBy,
      new Date().toISOString()
    )
  return Number(info.lastInsertRowid)
}

export function listSummaries(db: Database.Database, workspaceId: number): Summary[] {
  const rows = db
    .prepare('SELECT * FROM summary WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(workspaceId) as Array<{
    id: number
    period_type: string
    period_start: string
    period_end: string
    template: string
    content_md: string
    generated_by: string
    created_at: string
    edited_at: string | null
  }>
  return rows.map((r) => ({
    id: r.id,
    periodType: r.period_type,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    template: r.template as SummaryTemplate,
    contentMd: r.content_md,
    generatedBy: r.generated_by as AiGeneratedBy,
    createdAt: r.created_at,
    editedAt: r.edited_at
  }))
}

export function deleteSummary(db: Database.Database, workspaceId: number, id: number): void {
  db.prepare('DELETE FROM summary WHERE workspace_id = ? AND id = ?').run(workspaceId, id)
}

// ---- alerts ----

export interface AlertCandidate {
  ruleId: string
  issueKey: string | null
  severity: AlertSeverity
  message: string
  detailsJson?: string
}

export function reconcileAlerts(
  db: Database.Database,
  workspaceId: number,
  candidates: AlertCandidate[]
): void {
  const now = new Date().toISOString()
  const upsert = db.prepare(
    `INSERT INTO alert (workspace_id, rule_id, issue_key, severity, message, details_json, first_detected_at, last_seen_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(workspace_id, rule_id, issue_key) DO UPDATE SET
       severity=excluded.severity, message=excluded.message, details_json=excluded.details_json,
       last_seen_at=excluded.last_seen_at, resolved_at=NULL,
       dismissed_at = CASE WHEN alert.resolved_at IS NOT NULL THEN NULL ELSE alert.dismissed_at END`
  )
  const run = db.transaction(() => {
    for (const c of candidates) {
      upsert.run(
        workspaceId,
        c.ruleId,
        c.issueKey,
        c.severity,
        c.message,
        c.detailsJson ?? null,
        now,
        now
      )
    }
    // Alertas ativos que não apareceram nesta rodada -> resolvidos
    db.prepare(
      `UPDATE alert SET resolved_at = ? WHERE workspace_id = ? AND resolved_at IS NULL AND last_seen_at < ?`
    ).run(now, workspaceId, now)
  })
  run()
}

export function listActiveAlerts(db: Database.Database, workspaceId: number): Alert[] {
  const rows = db
    .prepare(
      `SELECT * FROM alert
       WHERE workspace_id = ? AND resolved_at IS NULL AND dismissed_at IS NULL
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC`
    )
    .all(workspaceId) as Array<{
    id: number
    rule_id: string
    issue_key: string | null
    severity: string
    message: string
    first_detected_at: string
    last_seen_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.rule_id,
    issueKey: r.issue_key,
    severity: r.severity as AlertSeverity,
    message: r.message,
    firstDetectedAt: r.first_detected_at,
    lastSeenAt: r.last_seen_at
  }))
}

export function dismissAlert(db: Database.Database, workspaceId: number, id: number): void {
  db.prepare('UPDATE alert SET dismissed_at = ? WHERE workspace_id = ? AND id = ?').run(
    new Date().toISOString(),
    workspaceId,
    id
  )
}

// ---- sync_state ----

export function getSyncCursor(
  db: Database.Database,
  workspaceId: number,
  resource: string
): string | null {
  const row = db
    .prepare('SELECT cursor FROM sync_state WHERE workspace_id = ? AND resource = ?')
    .get(workspaceId, resource) as { cursor: string | null } | undefined
  return row?.cursor ?? null
}

export function setSyncState(
  db: Database.Database,
  workspaceId: number,
  resource: string,
  state: { cursor?: string | null; status?: string; error?: string | null; success?: boolean }
): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO sync_state (workspace_id, resource, cursor, last_run_at, last_success_at, status, error)
     VALUES (@workspaceId, @resource, @cursor, @now, @successAt, @status, @error)
     ON CONFLICT(workspace_id, resource) DO UPDATE SET
       cursor = COALESCE(@cursor, sync_state.cursor),
       last_run_at = @now,
       last_success_at = COALESCE(@successAt, sync_state.last_success_at),
       status = COALESCE(@status, sync_state.status),
       error = @error`
  ).run({
    workspaceId,
    resource,
    cursor: state.cursor ?? null,
    now,
    successAt: state.success ? now : null,
    status: state.status ?? null,
    error: state.error ?? null
  })
}

export function getLastSuccessAt(db: Database.Database, workspaceId: number): string | null {
  const row = db
    .prepare(
      `SELECT MAX(last_success_at) AS at FROM sync_state WHERE workspace_id = ? AND resource = 'issues'`
    )
    .get(workspaceId) as { at: string | null } | undefined
  return row?.at ?? null
}

// ---- prefs ----

export function getPrefs(db: Database.Database): Prefs {
  const row = db.prepare(`SELECT value_json FROM user_pref WHERE key = 'prefs'`).get() as
    { value_json: string } | undefined
  if (!row) return { ...DEFAULT_PREFS }
  return { ...DEFAULT_PREFS, ...(JSON.parse(row.value_json) as Partial<Prefs>) }
}

export function setPrefs(db: Database.Database, patch: Partial<Prefs>): Prefs {
  const merged = { ...getPrefs(db), ...patch }
  db.prepare(
    `INSERT INTO user_pref (key, value_json) VALUES ('prefs', ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(JSON.stringify(merged))
  return merged
}
