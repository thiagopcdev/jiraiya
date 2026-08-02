import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  getIssueByKey,
  listChildIssues,
  updateIssueFields,
  upsertIssue,
  type IssueUpsert
} from './issue'

const iso = (d: string): string => new Date(d).toISOString()

function baseIssue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: 'desc',
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: 'acc-me',
    assigneeName: 'Eu',
    reporterAccountId: 'acc-other',
    reporterName: null,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-07-01T09:00:00Z'),
    updatedAt: iso('2026-07-16T10:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

describe('listChildIssues', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at) VALUES (1, 'https://x.atlassian.net', 'e', 'acc-me', 'now')`
    ).run()
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at) VALUES (2, 'https://y.atlassian.net', 'e2', 'acc-other', 'now')`
    ).run()
  })

  it('retorna issues com parent_key = parentKey do workspace, ordenadas por key', () => {
    upsertIssue(db, 1, baseIssue('BT-11', { parentKey: 'BT-1' }))
    upsertIssue(db, 1, baseIssue('BT-10', { parentKey: 'BT-1' }))
    const children = listChildIssues(db, 1, 'BT-1', 'https://x.atlassian.net')
    expect(children.map((c) => c.key)).toEqual(['BT-10', 'BT-11'])
  })

  it('exclui issue filha de outro pai', () => {
    upsertIssue(db, 1, baseIssue('BT-10', { parentKey: 'BT-1' }))
    upsertIssue(db, 1, baseIssue('BT-20', { parentKey: 'BT-2' }))
    const children = listChildIssues(db, 1, 'BT-1', 'https://x.atlassian.net')
    expect(children.map((c) => c.key)).toEqual(['BT-10'])
  })

  it('exclui issue de outro workspace mesmo com o mesmo parent_key', () => {
    upsertIssue(db, 1, baseIssue('BT-10', { parentKey: 'BT-1' }))
    upsertIssue(db, 2, baseIssue('BT-99', { parentKey: 'BT-1' }))
    const children = listChildIssues(db, 1, 'BT-1', 'https://x.atlassian.net')
    expect(children.map((c) => c.key)).toEqual(['BT-10'])
  })

  it('sem filhos -> []', () => {
    upsertIssue(db, 1, baseIssue('BT-1'))
    expect(listChildIssues(db, 1, 'BT-1', 'https://x.atlassian.net')).toEqual([])
  })

  it('DTO tem url montada com siteUrl', () => {
    upsertIssue(db, 1, baseIssue('BT-10', { parentKey: 'BT-1' }))
    const children = listChildIssues(db, 1, 'BT-1', 'https://x.atlassian.net')
    expect(children[0].url).toBe('https://x.atlassian.net/browse/BT-10')
  })
})

describe('updateIssueFields', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at) VALUES (1, 'https://x.atlassian.net', 'e', 'acc-me', 'now')`
    ).run()
    upsertIssue(db, 1, baseIssue('BT-1'))
  })

  it('patch com assigneeAccountId/assigneeName atualiza as colunas', () => {
    updateIssueFields(db, 1, 'BT-1', {
      assigneeAccountId: 'acc-novo',
      assigneeName: 'Novo Nome'
    })
    const row = getIssueByKey(db, 1, 'BT-1')
    expect(row?.assignee_account_id).toBe('acc-novo')
    expect(row?.assignee_name).toBe('Novo Nome')
  })

  it('patch com assigneeAccountId: null limpa a coluna (vira NULL)', () => {
    updateIssueFields(db, 1, 'BT-1', { assigneeAccountId: null, assigneeName: null })
    const row = getIssueByKey(db, 1, 'BT-1')
    expect(row?.assignee_account_id).toBeNull()
    expect(row?.assignee_name).toBeNull()
  })

  it('patch sem assignee não toca as colunas de assignee', () => {
    updateIssueFields(db, 1, 'BT-1', { storyPoints: 8 })
    const row = getIssueByKey(db, 1, 'BT-1')
    expect(row?.assignee_account_id).toBe('acc-me')
    expect(row?.assignee_name).toBe('Eu')
    expect(row?.story_points).toBe(8)
  })

  it('patch vazio -> no-op', () => {
    const before = getIssueByKey(db, 1, 'BT-1')
    updateIssueFields(db, 1, 'BT-1', {})
    const after = getIssueByKey(db, 1, 'BT-1')
    expect(after).toEqual(before)
  })
})
