import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { queryIssues } from './issues'

const ME = 'acc-me'
const now = new Date('2026-07-17T12:00:00Z')
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
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: 'acc-other',
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

describe('queryIssues buckets', () => {
  let db: Database.Database
  const ctx = (): Parameters<typeof queryIssues>[0] => ({
    db,
    workspaceId: 1,
    accountId: ME,
    siteUrl: 'https://x.atlassian.net'
  })
  const range = { start: iso('2026-07-10T00:00:00Z'), end: iso('2026-07-18T00:00:00Z') }

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('moved: só issues com status_change meu no período', () => {
    upsertIssue(db, 1, baseIssue('BT-1'))
    upsertIssue(db, 1, baseIssue('BT-2'))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-1',
        kind: 'status_change',
        actorAccountId: ME,
        actorName: 'Eu',
        field: 'status',
        fromValue: 'To Do',
        toValue: 'In Progress',
        bodyText: null,
        occurredAt: iso('2026-07-15T10:00:00Z'),
        sourceId: 'changelog:1:0'
      },
      {
        issueKey: 'BT-2',
        kind: 'status_change',
        actorAccountId: 'acc-other',
        actorName: 'Outro',
        field: 'status',
        fromValue: 'To Do',
        toValue: 'Done',
        bodyText: null,
        occurredAt: iso('2026-07-15T11:00:00Z'),
        sourceId: 'changelog:2:0'
      }
    ])
    const moved = queryIssues(ctx(), { ...range, bucket: 'moved', stalledDays: 3 })
    expect(moved.map((i) => i.key)).toEqual(['BT-1'])
  })

  it('done: resolvidas no período atribuídas a mim', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-3', {
        status: 'Done',
        statusCategory: 'done',
        resolvedAt: iso('2026-07-16T15:00:00Z')
      })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-4', {
        status: 'Done',
        statusCategory: 'done',
        resolvedAt: iso('2026-06-01T15:00:00Z') // fora do período
      })
    )
    const done = queryIssues(ctx(), { ...range, bucket: 'done', stalledDays: 3 })
    expect(done.map((i) => i.key)).toEqual(['BT-3'])
  })

  it('stalled: em andamento sem atividade há N dias', () => {
    upsertIssue(db, 1, baseIssue('BT-5', { updatedAt: iso('2026-07-01T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-6'))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-6',
        kind: 'comment',
        actorAccountId: ME,
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'andamento',
        occurredAt: new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString(),
        sourceId: 'comment:1'
      }
    ])
    const stalled = queryIssues(ctx(), { ...range, bucket: 'stalled', stalledDays: 3 })
    expect(stalled.map((i) => i.key)).toEqual(['BT-5'])
  })

  it('url monta link do browse', () => {
    upsertIssue(db, 1, baseIssue('BT-7'))
    const all = queryIssues(ctx(), { ...range, bucket: 'all', stalledDays: 3 })
    expect(all[0].url).toBe('https://x.atlassian.net/browse/BT-7')
  })
})
