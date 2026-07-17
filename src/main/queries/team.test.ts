import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities, type ActivityInsert } from '../db/repos/activity'
import { buildTeamSummary, discoverMembers } from './team'

const ME = 'acc-me'
const ANA = 'acc-ana'
const BRUNO = 'acc-bruno'
const iso = (d: string): string => new Date(d).toISOString()

function issue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
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
    reporterAccountId: ME,
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

function activity(over: Partial<ActivityInsert> & { sourceId: string }): ActivityInsert {
  return {
    issueKey: 'BT-1',
    kind: 'comment',
    actorAccountId: ME,
    actorName: 'Eu',
    field: null,
    fromValue: null,
    toValue: null,
    bodyText: 'oi',
    occurredAt: iso('2026-07-15T10:00:00Z'),
    ...over
  }
}

describe('team queries', () => {
  let db: Database.Database
  const workspace = { id: 1, account_id: ME, site_url: 'https://x.atlassian.net' }
  const range = { start: iso('2026-07-10T00:00:00Z'), end: iso('2026-07-18T00:00:00Z') }

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('discoverMembers junta atores do período e assignees de issues abertas', () => {
    upsertIssue(db, 1, issue('BT-1', { assigneeAccountId: BRUNO, assigneeName: 'Bruno' }))
    insertActivities(db, 1, [
      activity({ sourceId: 'c:1', actorAccountId: ANA, actorName: 'Ana' }),
      // fora do período: não deve entrar por atividade
      activity({
        sourceId: 'c:2',
        actorAccountId: 'acc-old',
        actorName: 'Antigo',
        occurredAt: iso('2026-01-01T10:00:00Z')
      })
    ])
    const ids = discoverMembers(db, 1, range)
      .map((m) => m.accountId)
      .sort()
    expect(ids).toEqual([ANA, BRUNO])
  })

  it('buildTeamSummary preenche o radar por pessoa e ordena eu por último', () => {
    // Ana: 1 em andamento + 1 concluída no período
    upsertIssue(db, 1, issue('BT-1', { assigneeAccountId: ANA, assigneeName: 'Ana' }))
    upsertIssue(
      db,
      1,
      issue('BT-2', {
        assigneeAccountId: ANA,
        assigneeName: 'Ana',
        status: 'Done',
        statusCategory: 'done',
        resolvedAt: iso('2026-07-16T12:00:00Z')
      })
    )
    // Eu: 1 em andamento
    upsertIssue(db, 1, issue('BT-3'))
    insertActivities(db, 1, [
      activity({ sourceId: 'c:1', issueKey: 'BT-1', actorAccountId: ANA, actorName: 'Ana' })
    ])

    const summary = buildTeamSummary(db, workspace, range, 3)
    expect(summary.map((m) => m.name)).toEqual(['Ana', 'Eu'])

    const ana = summary.find((m) => m.accountId === ANA)!
    expect(ana.isMe).toBe(false)
    expect(ana.inProgress.map((i) => i.key)).toEqual(['BT-1'])
    expect(ana.done.map((i) => i.key)).toEqual(['BT-2'])
    expect(ana.commentedCount).toBe(1)

    const me = summary.find((m) => m.accountId === ME)!
    expect(me.isMe).toBe(true)
    expect(me.inProgress.map((i) => i.key)).toEqual(['BT-3'])
  })

  it('anota dias de parado no bucket stalled', () => {
    upsertIssue(
      db,
      1,
      issue('BT-9', {
        assigneeAccountId: ANA,
        assigneeName: 'Ana',
        updatedAt: iso('2026-07-01T10:00:00Z')
      })
    )
    // registra a Ana como atora pra ela ser descoberta
    insertActivities(db, 1, [
      activity({ sourceId: 'c:1', issueKey: 'BT-1', actorAccountId: ANA, actorName: 'Ana' })
    ])
    const ana = buildTeamSummary(db, workspace, range, 3).find((m) => m.accountId === ANA)!
    expect(ana.stalled).toHaveLength(1)
    expect(ana.stalled[0].stalledDays).toBeGreaterThan(3)
  })
})
