import type Database from 'better-sqlite3'
import type { Workspace } from '@shared/domain'

interface WorkspaceRow {
  id: number
  site_url: string
  email: string
  account_id: string
  display_name: string | null
  time_zone: string | null
  story_points_field_id: string | null
  sprint_field_id: string | null
}

function toDto(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    siteUrl: row.site_url,
    email: row.email,
    accountId: row.account_id,
    displayName: row.display_name,
    timeZone: row.time_zone
  }
}

export function getWorkspace(db: Database.Database): Workspace | null {
  const row = db.prepare('SELECT * FROM workspace ORDER BY id LIMIT 1').get() as
    WorkspaceRow | undefined
  return row ? toDto(row) : null
}

export function getWorkspaceRow(db: Database.Database): WorkspaceRow | null {
  return (
    (db.prepare('SELECT * FROM workspace ORDER BY id LIMIT 1').get() as WorkspaceRow | undefined) ??
    null
  )
}

export function createWorkspace(
  db: Database.Database,
  data: {
    siteUrl: string
    email: string
    accountId: string
    displayName: string | null
    timeZone: string | null
  }
): Workspace {
  const info = db
    .prepare(
      `INSERT INTO workspace (site_url, email, account_id, display_name, time_zone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.siteUrl,
      data.email,
      data.accountId,
      data.displayName,
      data.timeZone,
      new Date().toISOString()
    )
  return {
    id: Number(info.lastInsertRowid),
    siteUrl: data.siteUrl,
    email: data.email,
    accountId: data.accountId,
    displayName: data.displayName,
    timeZone: data.timeZone
  }
}

export function setWorkspaceFields(
  db: Database.Database,
  workspaceId: number,
  fields: { storyPointsFieldId?: string | null; sprintFieldId?: string | null }
): void {
  if (fields.storyPointsFieldId !== undefined) {
    db.prepare('UPDATE workspace SET story_points_field_id = ? WHERE id = ?').run(
      fields.storyPointsFieldId,
      workspaceId
    )
  }
  if (fields.sprintFieldId !== undefined) {
    db.prepare('UPDATE workspace SET sprint_field_id = ? WHERE id = ?').run(
      fields.sprintFieldId,
      workspaceId
    )
  }
}

export function deleteWorkspace(db: Database.Database, workspaceId: number): void {
  db.prepare('DELETE FROM workspace WHERE id = ?').run(workspaceId)
}
