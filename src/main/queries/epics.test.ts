import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { epicsOverview } from './epics'

const SITE_URL = 'https://x.atlassian.net'

function insertWorkspace(db: Database.Database, id: number, siteUrl: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, @siteUrl, 'e@x.com', 'acc', 'now')`
  ).run({ id, siteUrl })
}

function insertEpic(
  db: Database.Database,
  workspaceId: number,
  opts: { key: string; issueType?: string; status?: string; statusCategory?: string }
): void {
  db.prepare(
    `INSERT INTO issue (
      workspace_id, jira_id, key, project_key, summary, issue_type, status, status_category
    ) VALUES (@workspaceId, @key, @key, 'BT', @summary, @issueType, @status, @statusCategory)`
  ).run({
    workspaceId,
    key: opts.key,
    summary: `Épico ${opts.key}`,
    issueType: opts.issueType ?? 'Epic',
    status: opts.status ?? 'In Progress',
    statusCategory: opts.statusCategory ?? 'indeterminate'
  })
}

function insertChild(
  db: Database.Database,
  workspaceId: number,
  opts: { key: string; parentKey: string; storyPoints?: number | null; statusCategory?: string }
): void {
  const statusCategory = opts.statusCategory ?? 'indeterminate'
  db.prepare(
    `INSERT INTO issue (
      workspace_id, jira_id, key, project_key, summary, issue_type, status, status_category,
      story_points, parent_key
    ) VALUES (
      @workspaceId, @key, @key, 'BT', @summary, 'Story', @status, @statusCategory,
      @storyPoints, @parentKey
    )`
  ).run({
    workspaceId,
    key: opts.key,
    summary: `Filho ${opts.key}`,
    status: statusCategory === 'done' ? 'Done' : 'In Progress',
    statusCategory,
    storyPoints: opts.storyPoints ?? null,
    parentKey: opts.parentKey
  })
}

describe('epicsOverview', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1, SITE_URL)
  })

  it('épico com 3 filhos (2 done, 1 aberto): total 3, done 2, spTotal 10, spDone 8', () => {
    insertEpic(db, 1, { key: 'BT-E1' })
    insertChild(db, 1, { key: 'BT-C1', parentKey: 'BT-E1', storyPoints: 3, statusCategory: 'done' })
    insertChild(db, 1, { key: 'BT-C2', parentKey: 'BT-E1', storyPoints: 5, statusCategory: 'done' })
    insertChild(db, 1, {
      key: 'BT-C3',
      parentKey: 'BT-E1',
      storyPoints: 2,
      statusCategory: 'indeterminate'
    })

    const result = epicsOverview(db, 1, SITE_URL)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      key: 'BT-E1',
      total: 3,
      done: 2,
      spTotal: 10,
      spDone: 8,
      url: `${SITE_URL}/browse/BT-E1`
    })
  })

  it('issue_type "Épico" (variação pt-BR) também conta como épico', () => {
    insertEpic(db, 1, { key: 'BT-E2', issueType: 'Épico' })

    const result = epicsOverview(db, 1, SITE_URL)

    expect(result.map((e) => e.key)).toContain('BT-E2')
  })

  it('issue_type em caixa mista ("epic", "EPIC") também conta (case-insensitive)', () => {
    insertEpic(db, 1, { key: 'BT-E3', issueType: 'epic' })
    insertEpic(db, 1, { key: 'BT-E3B', issueType: 'EPIC' })

    const result = epicsOverview(db, 1, SITE_URL)

    expect(result.map((e) => e.key)).toEqual(expect.arrayContaining(['BT-E3', 'BT-E3B']))
  })

  it('story_points NULL conta como 0 (mas soma no total de itens)', () => {
    insertEpic(db, 1, { key: 'BT-E4' })
    insertChild(db, 1, {
      key: 'BT-C4',
      parentKey: 'BT-E4',
      storyPoints: null,
      statusCategory: 'done'
    })

    const result = epicsOverview(db, 1, SITE_URL)
    const epic = result.find((e) => e.key === 'BT-E4')

    expect(epic).toMatchObject({ total: 1, done: 1, spTotal: 0, spDone: 0 })
  })

  it('épico sem filhos: total/done/spTotal/spDone 0, mas aparece na lista', () => {
    insertEpic(db, 1, { key: 'BT-E5' })

    const result = epicsOverview(db, 1, SITE_URL)
    const epic = result.find((e) => e.key === 'BT-E5')

    expect(epic).toMatchObject({ total: 0, done: 0, spTotal: 0, spDone: 0 })
  })

  it('ordenação: épico aberto vem antes de épico com status_category "done"', () => {
    insertEpic(db, 1, { key: 'BT-E6', status: 'Done', statusCategory: 'done' })
    insertEpic(db, 1, { key: 'BT-E7', status: 'In Progress', statusCategory: 'indeterminate' })

    const result = epicsOverview(db, 1, SITE_URL)
    const keys = result.map((e) => e.key)

    expect(keys.indexOf('BT-E7')).toBeLessThan(keys.indexOf('BT-E6'))
  })

  it('isolamento: filho de outro workspace não conta; épico de outro workspace não aparece', () => {
    insertWorkspace(db, 2, 'https://y.atlassian.net')
    insertEpic(db, 1, { key: 'BT-E8' })
    insertChild(db, 1, { key: 'BT-C8', parentKey: 'BT-E8', storyPoints: 1, statusCategory: 'done' })
    insertEpic(db, 2, { key: 'BT-E9' })
    // filho de outro workspace cujo parent_key "coincide" com o épico do workspace 1 — não deve contar
    insertChild(db, 2, {
      key: 'BT-C9',
      parentKey: 'BT-E8',
      storyPoints: 100,
      statusCategory: 'done'
    })

    const result = epicsOverview(db, 1, SITE_URL)

    expect(result.map((e) => e.key)).not.toContain('BT-E9')
    const epic8 = result.find((e) => e.key === 'BT-E8')
    expect(epic8).toMatchObject({ total: 1, done: 1, spTotal: 1, spDone: 1 })
  })
})
