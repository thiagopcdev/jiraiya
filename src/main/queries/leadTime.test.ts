import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { statusDurationsDays, buildLeadTime, type LeadTimeCtx } from './leadTime'

const ME = 'acc-me'
const OTHER = 'acc-other'
const iso = (d: string): string => new Date(d).toISOString()

function baseIssue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: 'desc',
    issueType: 'Task',
    status: 'Done',
    statusCategory: 'done',
    priority: 'Medium',
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: OTHER,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-06-01T00:00:00Z'),
    updatedAt: iso('2026-06-10T00:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

describe('statusDurationsDays (pura)', () => {
  it('1 change: A->B em 2 dias, resolve 3 dias depois', () => {
    const created = iso('2026-07-01T00:00:00Z')
    const changes = [{ fromValue: 'A', toValue: 'B', occurredAt: iso('2026-07-03T00:00:00Z') }]
    const end = iso('2026-07-06T00:00:00Z')
    expect(statusDurationsDays(changes, created, end)).toEqual([
      { status: 'A', days: 2 },
      { status: 'B', days: 3 }
    ])
  })

  it('3 changes com retorno ao mesmo status: soma as duas passagens', () => {
    const created = iso('2026-07-01T00:00:00Z')
    const changes = [
      { fromValue: 'A', toValue: 'B', occurredAt: iso('2026-07-02T00:00:00Z') }, // dia1
      { fromValue: 'B', toValue: 'A', occurredAt: iso('2026-07-03T00:00:00Z') }, // dia2
      { fromValue: 'A', toValue: 'C', occurredAt: iso('2026-07-05T00:00:00Z') } // dia4
    ]
    const end = iso('2026-07-07T00:00:00Z') // dia6
    const result = statusDurationsDays(changes, created, end)
    const byStatus = Object.fromEntries(result.map((r) => [r.status, r.days]))
    // A: dia0->dia1 (1) + dia2->dia4 (2) = 3 ; B: dia1->dia2 (1) ; C: dia4->dia6 (2)
    expect(byStatus).toEqual({ A: 3, B: 1, C: 2 })
  })

  it('changes fora de ordem: resultado igual após embaralhar', () => {
    const created = iso('2026-07-01T00:00:00Z')
    const ordered = [
      { fromValue: 'A', toValue: 'B', occurredAt: iso('2026-07-02T00:00:00Z') },
      { fromValue: 'B', toValue: 'A', occurredAt: iso('2026-07-03T00:00:00Z') },
      { fromValue: 'A', toValue: 'C', occurredAt: iso('2026-07-05T00:00:00Z') }
    ]
    const shuffled = [ordered[2], ordered[0], ordered[1]]
    const end = iso('2026-07-07T00:00:00Z')
    expect(statusDurationsDays(shuffled, created, end)).toEqual(
      statusDurationsDays(ordered, created, end)
    )
  })

  it('sem changes -> []', () => {
    expect(
      statusDurationsDays([], iso('2026-07-01T00:00:00Z'), iso('2026-07-05T00:00:00Z'))
    ).toEqual([])
  })

  it('endAt antes do último change: segmento final ignorado (negativo)', () => {
    const created = iso('2026-07-01T00:00:00Z')
    const changes = [
      { fromValue: 'A', toValue: 'B', occurredAt: iso('2026-07-02T00:00:00Z') }, // dia1
      { fromValue: 'B', toValue: 'C', occurredAt: iso('2026-07-06T00:00:00Z') } // dia5
    ]
    const end = iso('2026-07-04T00:00:00Z') // dia3, antes do último change (dia5)
    const result = statusDurationsDays(changes, created, end)
    const byStatus = Object.fromEntries(result.map((r) => [r.status, r.days]))
    expect(byStatus.A).toBe(1)
    expect(byStatus.B).toBe(4) // segmento intermediário, não afetado por endAt
    expect(byStatus.C).toBeUndefined() // segmento final negativo -> ignorado
  })
})

describe('buildLeadTime', () => {
  let db: Database.Database
  const ctx = (): LeadTimeCtx => ({ db, workspaceId: 1, accountId: ME })

  const DAY = 24 * 3600 * 1000
  const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString()

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('2 cards meus com durações conhecidas geram médias corretas (avgDays, samples, ordenação DESC)', () => {
    // BT-1: A por 2 dias, B por 3 dias
    upsertIssue(db, 1, baseIssue('BT-1', { createdAt: daysAgo(10), resolvedAt: daysAgo(5) }))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-1',
        kind: 'status_change',
        actorAccountId: ME,
        actorName: 'Eu',
        field: 'status',
        fromValue: 'A',
        toValue: 'B',
        bodyText: null,
        occurredAt: daysAgo(8),
        sourceId: 'changelog:BT-1:0'
      }
    ])
    // BT-2: A por 1 dia, B por 3 dias
    upsertIssue(db, 1, baseIssue('BT-2', { createdAt: daysAgo(9), resolvedAt: daysAgo(5) }))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-2',
        kind: 'status_change',
        actorAccountId: ME,
        actorName: 'Eu',
        field: 'status',
        fromValue: 'A',
        toValue: 'B',
        bodyText: null,
        occurredAt: daysAgo(8),
        sourceId: 'changelog:BT-2:0'
      }
    ])

    const result = buildLeadTime(ctx(), { days: 14 })
    const byStatus = Object.fromEntries(result.statuses.map((s) => [s.status, s]))

    expect(byStatus.A.avgDays).toBe(1.5) // (2+1)/2
    expect(byStatus.A.samples).toBe(2)
    expect(byStatus.B.avgDays).toBe(3) // (3+3)/2
    expect(byStatus.B.samples).toBe(2)
    expect(result.statuses.map((s) => s.status)).toEqual(['B', 'A']) // avgDays DESC
    expect(result.cardCount).toBe(2)
    expect(result.windowDays).toBe(14)
  })

  it('card de outra pessoa fica de fora mesmo resolvido na janela', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-3', {
        assigneeAccountId: OTHER,
        assigneeName: 'Outro',
        createdAt: daysAgo(10),
        resolvedAt: daysAgo(5)
      })
    )
    insertActivities(db, 1, [
      {
        issueKey: 'BT-3',
        kind: 'status_change',
        actorAccountId: OTHER,
        actorName: 'Outro',
        field: 'status',
        fromValue: 'A',
        toValue: 'B',
        bodyText: null,
        occurredAt: daysAgo(8),
        sourceId: 'changelog:BT-3:0'
      }
    ])

    const result = buildLeadTime(ctx(), { days: 14 })
    expect(result.cardCount).toBe(0)
    expect(result.statuses).toEqual([])
  })

  it('card meu resolvido fora da janela fica de fora', () => {
    upsertIssue(db, 1, baseIssue('BT-4', { createdAt: daysAgo(25), resolvedAt: daysAgo(20) }))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-4',
        kind: 'status_change',
        actorAccountId: ME,
        actorName: 'Eu',
        field: 'status',
        fromValue: 'A',
        toValue: 'B',
        bodyText: null,
        occurredAt: daysAgo(22),
        sourceId: 'changelog:BT-4:0'
      }
    ])

    const result = buildLeadTime(ctx(), { days: 14 })
    expect(result.cardCount).toBe(0)
    expect(result.statuses).toEqual([])
  })

  it('card sem status_change conta em cardCount mas não gera status', () => {
    upsertIssue(db, 1, baseIssue('BT-5', { createdAt: daysAgo(6), resolvedAt: daysAgo(3) }))

    const result = buildLeadTime(ctx(), { days: 14 })
    expect(result.cardCount).toBe(1)
    expect(result.statuses).toEqual([])
  })
})
