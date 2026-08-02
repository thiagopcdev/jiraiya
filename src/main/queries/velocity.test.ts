import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { upsertSprints } from '../db/repos/catalog'
import { buildVelocity, type VelocityCtx } from './velocity'

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
    assigneeAccountId: OTHER,
    assigneeName: 'Outro',
    reporterAccountId: OTHER,
    reporterName: null,
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

describe('buildVelocity', () => {
  let db: Database.Database
  const ctx = (): VelocityCtx => ({ db, workspaceId: 1, accountId: ME })

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('janela vs associação: resolved_at define a sprint, sprint_jira_id é ignorado', () => {
    // Sprint 1: 01-14/jun; Sprint 2: 15-28/jun (mesmo board, fechadas)
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
      }
    ])
    // resolved em 10/jun (sprint 1), mas sprint_jira_id aponta para sprint 2
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        resolvedAt: iso('2026-06-10T12:00:00Z'),
        sprintJiraId: 2,
        storyPoints: 5
      })
    )
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toHaveLength(2)
    const [s1, s2] = result.sprints
    expect(s1.sprintJiraId).toBe(1)
    expect(s1.teamCount).toBe(1)
    expect(s1.teamPoints).toBe(5)
    expect(s2.sprintJiraId).toBe(2)
    expect(s2.teamCount).toBe(0)
    expect(s2.teamPoints).toBe(0)
  })

  it('atribuição: assignee direto conta como meu, e também activity kind=resolved', () => {
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
    // A: assignee = eu
    upsertIssue(
      db,
      1,
      baseIssue('BT-A', {
        assigneeAccountId: ME,
        resolvedAt: iso('2026-06-05T10:00:00Z'),
        storyPoints: 2
      })
    )
    // B: assignee = outro, mas activity resolved por mim
    upsertIssue(
      db,
      1,
      baseIssue('BT-B', {
        assigneeAccountId: OTHER,
        resolvedAt: iso('2026-06-06T10:00:00Z'),
        storyPoints: 3
      })
    )
    insertActivities(db, 1, [
      {
        issueKey: 'BT-B',
        kind: 'resolved',
        actorAccountId: ME,
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: 'Done',
        bodyText: null,
        occurredAt: iso('2026-06-06T10:00:00Z'),
        sourceId: 'resolved:BT-B'
      }
    ])
    // C: alheia, assignee outro e sem activity minha
    upsertIssue(
      db,
      1,
      baseIssue('BT-C', {
        assigneeAccountId: OTHER,
        resolvedAt: iso('2026-06-07T10:00:00Z'),
        storyPoints: 4
      })
    )
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toHaveLength(1)
    const s = result.sprints[0]
    expect(s.myCount).toBe(2)
    expect(s.myPoints).toBe(5) // A(2) + B(3)
    expect(s.teamCount).toBe(3)
    expect(s.teamPoints).toBe(9) // A+B+C = 2+3+4
  })

  it('sprint ativa sem complete_date: resolved_at recente conta nela (end_date futuro ou null)', () => {
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString()
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint Ativa',
        state: 'active',
        startDate: iso('2026-07-14T00:00:00Z'),
        endDate: soon,
        completeDate: null
      }
    ])
    const recentResolved = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
    upsertIssue(
      db,
      1,
      baseIssue('BT-D', { resolvedAt: recentResolved, storyPoints: 8, assigneeAccountId: ME })
    )
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toHaveLength(1)
    expect(result.sprints[0].teamCount).toBe(1)
    expect(result.sprints[0].myCount).toBe(1)
    expect(result.sprints[0].myPoints).toBe(8)
  })

  it('sprint ativa sem end_date (null): usa "agora" como fim efetivo', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint Ativa Sem Fim',
        state: 'active',
        startDate: iso('2026-07-01T00:00:00Z'),
        endDate: null,
        completeDate: null
      }
    ])
    const recentResolved = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
    upsertIssue(db, 1, baseIssue('BT-E', { resolvedAt: recentResolved, storyPoints: 1 }))
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toHaveLength(1)
    expect(result.sprints[0].teamCount).toBe(1)
    // endDate retornado deve ser aproximadamente "agora" (não null, não vazio)
    expect(result.sprints[0].endDate).toBeTruthy()
    expect(new Date(result.sprints[0].endDate).getTime()).toBeGreaterThan(
      new Date('2026-07-01T00:00:00Z').getTime()
    )
  })

  it('story_points null: entra em counts, 0 em points', () => {
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
      baseIssue('BT-F', {
        resolvedAt: iso('2026-06-05T10:00:00Z'),
        storyPoints: null,
        assigneeAccountId: ME
      })
    )
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    const s = result.sprints[0]
    expect(s.teamCount).toBe(1)
    expect(s.teamPoints).toBe(0)
    expect(s.myCount).toBe(1)
    expect(s.myPoints).toBe(0)
  })

  it('ordem: retorno da mais antiga para a mais nova', () => {
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
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints.map((s) => s.sprintJiraId)).toEqual([1, 2, 3])
  })

  it('sobreposição: 2 sprints de boards diferentes com janelas sobrepostas; issue na interseção soma 2x nas barras mas 1x nos totals', () => {
    // Board A: 01-20/jun; Board B: 10-30/jun (sobrepostas em 10-20/jun)
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Board A Sprint',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-20T23:59:59Z'),
        completeDate: iso('2026-06-20T23:59:59Z')
      },
      {
        jiraId: 2,
        boardJiraId: 200,
        name: 'Board B Sprint',
        state: 'closed',
        startDate: iso('2026-06-10T00:00:00Z'),
        endDate: iso('2026-06-30T23:59:59Z'),
        completeDate: iso('2026-06-30T23:59:59Z')
      }
    ])
    upsertIssue(
      db,
      1,
      baseIssue('BT-OVERLAP', {
        resolvedAt: iso('2026-06-15T10:00:00Z'), // na interseção
        storyPoints: 5,
        assigneeAccountId: ME
      })
    )
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toHaveLength(2)
    // conta nas duas barras
    for (const s of result.sprints) {
      expect(s.teamCount).toBe(1)
      expect(s.teamPoints).toBe(5)
      expect(s.myCount).toBe(1)
      expect(s.myPoints).toBe(5)
    }
    // mas totals conta só 1x
    expect(result.totals.teamCount).toBe(1)
    expect(result.totals.teamPoints).toBe(5)
    expect(result.totals.myCount).toBe(1)
    expect(result.totals.myPoints).toBe(5)
  })

  it('sem sprints: retorna vazio/zeros', () => {
    const result = buildVelocity(ctx(), { sprintCount: 10 })
    expect(result.sprints).toEqual([])
    expect(result.totals).toEqual({ myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 })
  })
})
