import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { upsertSprints } from '../db/repos/catalog'
import { sprintTrends } from './trends'

const ME = 'acc-me'
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
    reporterAccountId: ME,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-06-01T09:00:00Z'),
    updatedAt: iso('2026-06-10T10:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

describe('sprintTrends', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('entrega básica: 2 issues, SP 3+5, uma com created_at 4 dias antes do resolved → confere média', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      }
    ])
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        storyPoints: 3,
        createdAt: iso('2026-06-01T10:00:00Z'),
        resolvedAt: iso('2026-06-05T10:00:00Z') // 4 dias depois
      })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-2', {
        storyPoints: 5,
        createdAt: iso('2026-05-01T10:00:00Z'),
        resolvedAt: iso('2026-06-06T10:00:00Z')
      })
    )
    const result = sprintTrends(db, 1, 6)
    expect(result).toHaveLength(1)
    const s = result[0]
    expect(s.jiraId).toBe(1)
    expect(s.deliveredSp).toBe(8)
    expect(s.deliveredCount).toBe(2)
    // média: (4 dias + (05/jun a 06/jun tem createdAt bem antes, mas ambas contam)
    // BT-1: created 01/06 10:00 -> resolved 05/06 10:00 = 4 dias
    // BT-2: created 01/05 10:00 -> resolved 06/06 10:00 = 36 dias
    // média = (4+36)/2 = 20
    expect(s.avgLeadDays).toBe(20)
  })

  it('SP null conta 0 mas card conta em deliveredCount', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      }
    ])
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        storyPoints: null,
        resolvedAt: iso('2026-06-05T10:00:00Z')
      })
    )
    const result = sprintTrends(db, 1, 6)
    expect(result[0].deliveredSp).toBe(0)
    expect(result[0].deliveredCount).toBe(1)
  })

  it('issue resolvida fora da janela não conta', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      }
    ])
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        storyPoints: 5,
        resolvedAt: iso('2026-06-20T10:00:00Z') // depois do fim da sprint
      })
    )
    const result = sprintTrends(db, 1, 6)
    expect(result[0].deliveredCount).toBe(0)
    expect(result[0].deliveredSp).toBe(0)
  })

  it('sprint aberta (state=active) não aparece', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint Ativa',
        state: 'active',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: null
      }
    ])
    const result = sprintTrends(db, 1, 6)
    expect(result).toEqual([])
  })

  it('ordenação antiga→recente com 3 sprints', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'Sprint 2',
        state: 'closed',
        startDate: iso('2026-06-15T00:00:00Z'),
        endDate: iso('2026-06-28T23:59:59Z'),
        completeDate: iso('2026-06-28T23:59:59Z')
      },
      {
        jiraId: 3,
        boardJiraId: 100,
        name: 'Sprint 3',
        state: 'closed',
        startDate: iso('2026-06-29T00:00:00Z'),
        endDate: iso('2026-07-12T23:59:59Z'),
        completeDate: iso('2026-07-12T23:59:59Z')
      }
    ])
    const result = sprintTrends(db, 1, 6)
    expect(result.map((s) => s.jiraId)).toEqual([1, 2, 3])
  })

  it('sprintCount=2 pega as 2 mais recentes', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'Sprint 2',
        state: 'closed',
        startDate: iso('2026-06-15T00:00:00Z'),
        endDate: iso('2026-06-28T23:59:59Z'),
        completeDate: iso('2026-06-28T23:59:59Z')
      },
      {
        jiraId: 3,
        boardJiraId: 100,
        name: 'Sprint 3',
        state: 'closed',
        startDate: iso('2026-06-29T00:00:00Z'),
        endDate: iso('2026-07-12T23:59:59Z'),
        completeDate: iso('2026-07-12T23:59:59Z')
      }
    ])
    const result = sprintTrends(db, 1, 2)
    expect(result.map((s) => s.jiraId)).toEqual([2, 3])
  })

  it('createdDuringCount conta criados na janela e ignora criados fora', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      }
    ])
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        createdAt: iso('2026-06-05T10:00:00Z'), // dentro da janela
        resolvedAt: null
      })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-2', {
        createdAt: iso('2026-05-01T10:00:00Z'), // fora da janela
        resolvedAt: null
      })
    )
    const result = sprintTrends(db, 1, 6)
    expect(result[0].createdDuringCount).toBe(1)
  })

  it('avgLeadDays null quando nada entregue', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T23:59:59Z'),
        completeDate: iso('2026-06-14T23:59:59Z')
      }
    ])
    const result = sprintTrends(db, 1, 6)
    expect(result[0].deliveredCount).toBe(0)
    expect(result[0].avgLeadDays).toBeNull()
  })
})
