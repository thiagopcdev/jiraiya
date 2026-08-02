import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { upsertSprints } from '../db/repos/catalog'
import { buildRetroDigest, renderRetroTemplate, type RetroCtx } from './retro'

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
    reporterName: null,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-06-25T09:00:00Z'),
    updatedAt: iso('2026-07-05T10:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

describe('buildRetroDigest / renderRetroTemplate', () => {
  let db: Database.Database
  const ctx = (): RetroCtx => ({ db, workspaceId: 1, accountId: ME })

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint 42',
        state: 'closed',
        startDate: iso('2026-07-01T00:00:00Z'),
        endDate: iso('2026-07-14T23:59:59Z'),
        completeDate: iso('2026-07-14T23:59:59Z')
      }
    ])
  })

  it('digest com números corretos: 2 meus + 1 alheio na janela, 1 fora da janela excluído, 1 reprovação, 1 aberto', () => {
    // BT-1: meu (assignee direto), entregue na janela
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        summary: 'Corrigir bug de login',
        storyPoints: 5,
        resolvedAt: iso('2026-07-05T10:00:00Z')
      })
    )
    // BT-2: assignee é outro, mas resolvido por mim (activity kind=resolved) -> conta como meu
    upsertIssue(
      db,
      1,
      baseIssue('BT-2', {
        summary: 'Ajustar layout responsivo',
        assigneeAccountId: OTHER,
        assigneeName: 'Outro',
        storyPoints: 3,
        resolvedAt: iso('2026-07-06T10:00:00Z')
      })
    )
    insertActivities(db, 1, [
      {
        issueKey: 'BT-2',
        kind: 'resolved',
        actorAccountId: ME,
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: 'Done',
        bodyText: null,
        occurredAt: iso('2026-07-06T10:00:00Z'),
        sourceId: 'resolved:BT-2'
      }
    ])
    // BT-3: alheio, entregue na janela, mas não é meu
    upsertIssue(
      db,
      1,
      baseIssue('BT-3', {
        summary: 'Outra entrega do time',
        assigneeAccountId: OTHER,
        assigneeName: 'Outro',
        storyPoints: 2,
        resolvedAt: iso('2026-07-07T10:00:00Z')
      })
    )
    // BT-4: meu, mas resolvido fora da janela da sprint -> excluído de tudo
    upsertIssue(
      db,
      1,
      baseIssue('BT-4', {
        summary: 'Fora da janela',
        storyPoints: 10,
        resolvedAt: iso('2026-06-20T10:00:00Z')
      })
    )
    // activity de reprovação dentro da janela
    insertActivities(db, 1, [
      {
        issueKey: 'BT-3',
        kind: 'status_change',
        actorAccountId: OTHER,
        actorName: 'Outro',
        field: 'status',
        fromValue: 'Em Revisão',
        toValue: 'Reprovado',
        bodyText: null,
        occurredAt: iso('2026-07-08T09:00:00Z'),
        sourceId: 'changelog:BT-3:0'
      }
    ])
    // BT-5: ainda aberto, pertence à sprint
    upsertIssue(
      db,
      1,
      baseIssue('BT-5', {
        summary: 'Ainda em andamento',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        sprintJiraId: 1,
        resolvedAt: null
      })
    )

    const digest = buildRetroDigest(ctx(), 1)
    expect(digest).not.toBeNull()
    expect(digest!.sprint.jiraId).toBe(1)
    expect(digest!.sprint.name).toBe('Sprint 42')
    expect(digest!.myTotals).toEqual({ points: 8, cards: 2 }) // BT-1(5) + BT-2(3)
    expect(digest!.teamTotals).toEqual({ points: 10, cards: 3 }) // BT-1+BT-2+BT-3
    expect(digest!.rejectedCount).toBe(1)
    expect(digest!.openAtEnd).toBe(1) // BT-5
    expect(digest!.myDone.map((d) => d.key).sort()).toEqual(['BT-1', 'BT-2'])

    const md = renderRetroTemplate(digest!)
    expect(md).toContain('Sprint 42')
    expect(md).toContain('## Números')
    expect(md).toContain('## O que eu entreguei')
    expect(md).toContain('- BT-1 — Corrigir bug de login')
    expect(md).toContain('- BT-2 — Ajustar layout responsivo')
  })

  it('sprint inexistente -> null', () => {
    expect(buildRetroDigest(ctx(), 999)).toBeNull()
  })
})
