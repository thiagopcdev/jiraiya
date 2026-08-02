import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { queryIssues, searchIssues } from './issues'

const ME = 'acc-me'
// dinâmico: o bucket 'stalled' compara com o relógio real (Date.now())
const now = new Date()
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

  it('rejected: meus cards abertos com status de reprovação (padrão pt/en)', () => {
    upsertIssue(db, 1, baseIssue('BT-10', { status: 'Reprovado' }))
    upsertIssue(db, 1, baseIssue('BT-11', { status: 'REPROVADO' }))
    upsertIssue(db, 1, baseIssue('BT-12', { status: 'Rejected' }))
    upsertIssue(db, 1, baseIssue('BT-13', { status: 'In Progress' })) // não reprovado
    upsertIssue(db, 1, baseIssue('BT-14', { status: 'Reprovado', assigneeAccountId: 'acc-outro' })) // não é meu
    upsertIssue(
      db,
      1,
      baseIssue('BT-15', {
        status: 'Reprovado',
        statusCategory: 'done',
        resolvedAt: iso('2026-07-16T10:00:00Z')
      })
    ) // concluído -> fora
    const rejected = queryIssues(ctx(), { ...range, bucket: 'rejected', stalledDays: 3 })
    expect(rejected.map((i) => i.key).sort()).toEqual(['BT-10', 'BT-11', 'BT-12'])
  })

  it('mine: meus cards abertos (new/indeterminate/null), exclui done e outro assignee, ignora período e ordena por updated_at DESC', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-20', { statusCategory: 'new', updatedAt: iso('2026-07-16T09:00:00Z') })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-21', {
        statusCategory: 'indeterminate',
        updatedAt: iso('2026-07-17T09:00:00Z')
      })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-22', { statusCategory: null, updatedAt: iso('2026-07-15T09:00:00Z') })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-23', { statusCategory: 'done', updatedAt: iso('2026-07-17T10:00:00Z') })
    ) // done -> excluído mesmo sendo o mais recente
    upsertIssue(
      db,
      1,
      baseIssue('BT-24', { statusCategory: 'new', assigneeAccountId: 'acc-outro' })
    ) // outro assignee -> excluído
    upsertIssue(db, 1, baseIssue('BT-25', { statusCategory: 'new', assigneeAccountId: null })) // sem assignee -> excluído
    upsertIssue(
      db,
      1,
      baseIssue('BT-26', { statusCategory: 'new', updatedAt: iso('2020-01-01T00:00:00Z') })
    ) // fora do range [start,end) -> ainda aparece (bucket ignora período)

    const mine = queryIssues(ctx(), { ...range, bucket: 'mine', stalledDays: 3 })
    expect(mine.map((i) => i.key)).toEqual(['BT-21', 'BT-20', 'BT-22', 'BT-26'])
  })
})

describe('searchIssues', () => {
  let db: Database.Database
  const ctx = (): Parameters<typeof searchIssues>[0] => ({
    db,
    workspaceId: 1,
    accountId: ME,
    siteUrl: 'https://x.atlassian.net'
  })

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('match por key (case-insensitive, parcial): "bt-7" acha BT-7x', () => {
    upsertIssue(db, 1, baseIssue('BT-70', { updatedAt: iso('2026-07-16T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-71', { updatedAt: iso('2026-07-15T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-99', { updatedAt: iso('2026-07-17T10:00:00Z') }))
    const found = searchIssues(ctx(), 'bt-7', 10)
    expect(found.map((i) => i.key).sort()).toEqual(['BT-70', 'BT-71'])
  })

  it('match por palavra do summary (case-insensitive)', () => {
    upsertIssue(db, 1, baseIssue('BT-1', { summary: 'Corrigir bug de LOGIN no app' }))
    upsertIssue(db, 1, baseIssue('BT-2', { summary: 'Outra tarefa qualquer' }))
    const found = searchIssues(ctx(), 'login', 10)
    expect(found.map((i) => i.key)).toEqual(['BT-1'])
  })

  it('match por texto da descrição', () => {
    upsertIssue(db, 1, baseIssue('BT-1', { descriptionText: 'Contexto sobre TIMEOUT de rede' }))
    upsertIssue(db, 1, baseIssue('BT-2', { descriptionText: 'nada a ver' }))
    const found = searchIssues(ctx(), 'timeout', 10)
    expect(found.map((i) => i.key)).toEqual(['BT-1'])
  })

  it('sem match -> []', () => {
    upsertIssue(db, 1, baseIssue('BT-1'))
    expect(searchIssues(ctx(), 'inexistente-xyz', 10)).toEqual([])
  })

  it('respeita o limit', () => {
    upsertIssue(db, 1, baseIssue('BT-1', { updatedAt: iso('2026-07-10T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-2', { updatedAt: iso('2026-07-11T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-3', { updatedAt: iso('2026-07-12T10:00:00Z') }))
    const found = searchIssues(ctx(), 'bt', 2)
    expect(found).toHaveLength(2)
  })

  it('ordena por updated_at DESC', () => {
    upsertIssue(db, 1, baseIssue('BT-1', { updatedAt: iso('2026-07-10T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-2', { updatedAt: iso('2026-07-15T10:00:00Z') }))
    upsertIssue(db, 1, baseIssue('BT-3', { updatedAt: iso('2026-07-12T10:00:00Z') }))
    const found = searchIssues(ctx(), 'bt', 10)
    expect(found.map((i) => i.key)).toEqual(['BT-2', 'BT-3', 'BT-1'])
  })
})
