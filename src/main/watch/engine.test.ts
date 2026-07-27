import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { runWatchEngine } from './engine'

const SITE_URL = 'https://x.atlassian.net'
const ME = 'acc-me'
const OTHER = 'acc-outro'

function insertWorkspace(db: Database.Database, id: number): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, @siteUrl, 'e@x.com', @accountId, 'now')`
  ).run({ id, siteUrl: SITE_URL, accountId: ME })
}

function insertIssue(
  db: Database.Database,
  workspaceId: number,
  key: string,
  opts: { summary?: string; status?: string } = {}
): void {
  db.prepare(
    `INSERT INTO issue (workspace_id, jira_id, key, project_key, summary, issue_type, status, status_category)
     VALUES (@workspaceId, @key, @key, 'BT', @summary, 'Story', @status, 'indeterminate')`
  ).run({
    workspaceId,
    key,
    summary: opts.summary ?? `Card ${key}`,
    status: opts.status ?? 'To Do'
  })
}

function insertWatch(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  opts: { lastStatus?: string | null; lastActivityAt?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO watch (workspace_id, issue_key, last_status, last_activity_at, created_at)
     VALUES (@workspaceId, @issueKey, @lastStatus, @lastActivityAt, 'now')`
  ).run({
    workspaceId,
    issueKey,
    lastStatus: opts.lastStatus ?? null,
    lastActivityAt: opts.lastActivityAt ?? null
  })
}

function insertComment(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  sourceId: string,
  actorAccountId: string,
  occurredAt: string
): void {
  db.prepare(
    `INSERT INTO issue_activity
      (workspace_id, issue_key, kind, actor_account_id, actor_name, body_text, occurred_at, source_id)
     VALUES (@workspaceId, @issueKey, 'comment', @actorAccountId, 'Alguém', 'comentário', @occurredAt, @sourceId)`
  ).run({ workspaceId, issueKey, actorAccountId, occurredAt, sourceId })
}

function watchRow(
  db: Database.Database,
  workspaceId: number,
  issueKey: string
): { last_status: string | null; last_activity_at: string | null } {
  return db
    .prepare(
      'SELECT last_status, last_activity_at FROM watch WHERE workspace_id = ? AND issue_key = ?'
    )
    .get(workspaceId, issueKey) as { last_status: string | null; last_activity_at: string | null }
}

describe('runWatchEngine', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1)
  })

  it('mudança de status: gera 1 evento kind status com a mensagem citando o status antigo e o novo, e atualiza last_status', () => {
    insertIssue(db, 1, 'BT-1', { status: 'Em teste' })
    insertWatch(db, 1, 'BT-1', { lastStatus: 'To Do', lastActivityAt: '2026-07-01T00:00:00Z' })

    const events = runWatchEngine(db, 1, ME)

    expect(events).toHaveLength(1)
    expect(events[0].issueKey).toBe('BT-1')
    expect(events[0].kind).toBe('status')
    expect(events[0].message).toContain('To Do')
    expect(events[0].message).toContain('Em teste')

    expect(watchRow(db, 1, 'BT-1').last_status).toBe('Em teste')
  })

  it('2 comentários novos de outra conta após last_activity_at → evento kind activity mencionando a contagem 2', () => {
    insertIssue(db, 1, 'BT-2', { status: 'To Do' })
    insertWatch(db, 1, 'BT-2', { lastStatus: 'To Do', lastActivityAt: '2026-07-01T00:00:00Z' })
    insertComment(db, 1, 'BT-2', 'c1', OTHER, '2026-07-10T10:00:00Z')
    insertComment(db, 1, 'BT-2', 'c2', OTHER, '2026-07-11T10:00:00Z')

    const events = runWatchEngine(db, 1, ME)

    expect(events).toHaveLength(1)
    expect(events[0].issueKey).toBe('BT-2')
    expect(events[0].kind).toBe('activity')
    expect(events[0].message).toContain('2')
  })

  it('comentário do próprio selfAccountId não gera evento', () => {
    insertIssue(db, 1, 'BT-3', { status: 'To Do' })
    insertWatch(db, 1, 'BT-3', { lastStatus: 'To Do', lastActivityAt: '2026-07-01T00:00:00Z' })
    insertComment(db, 1, 'BT-3', 'c1', ME, '2026-07-10T10:00:00Z')

    const events = runWatchEngine(db, 1, ME)

    expect(events).toEqual([])
  })

  it('last_activity_at null (baseline): sem eventos, mas a linha é atualizada', () => {
    insertIssue(db, 1, 'BT-4', { status: 'To Do' })
    insertWatch(db, 1, 'BT-4', { lastStatus: 'To Do', lastActivityAt: null })
    insertComment(db, 1, 'BT-4', 'c1', OTHER, '2026-07-10T10:00:00Z')

    const events = runWatchEngine(db, 1, ME)

    expect(events).toEqual([])
    expect(watchRow(db, 1, 'BT-4').last_activity_at).not.toBeNull()
  })

  it('watch de key sem issue local → sem evento e sem crash', () => {
    insertWatch(db, 1, 'BT-999', { lastStatus: 'To Do', lastActivityAt: '2026-07-01T00:00:00Z' })

    let events: unknown[] = []
    expect(() => {
      events = runWatchEngine(db, 1, ME)
    }).not.toThrow()
    expect(events).toEqual([])
  })

  it('status igual e sem atividade nova → []', () => {
    insertIssue(db, 1, 'BT-5', { status: 'To Do' })
    insertWatch(db, 1, 'BT-5', { lastStatus: 'To Do', lastActivityAt: '2026-07-20T00:00:00Z' })

    const events = runWatchEngine(db, 1, ME)

    expect(events).toEqual([])
  })
})
