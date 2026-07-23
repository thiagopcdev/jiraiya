import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { insertActivities } from '../db/repos/activity'
import { collectPeriodComments } from './selectors'

const ME = 'acc-me'
const iso = (d: string): string => new Date(d).toISOString()

function baseIssue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: null,
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: null,
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: null,
    storyPoints: null,
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

function comment(
  issueKey: string,
  actor: string,
  when: string,
  text: string,
  sourceId: string
): Parameters<typeof insertActivities>[2][number] {
  return {
    issueKey,
    kind: 'comment',
    actorAccountId: actor,
    actorName: actor === ME ? 'Eu' : 'Outro',
    field: null,
    fromValue: null,
    toValue: null,
    bodyText: text,
    occurredAt: iso(when),
    sourceId
  }
}

describe('collectPeriodComments', () => {
  let db: Database.Database
  const ws = { id: 1, account_id: ME }
  const range = { start: iso('2026-07-10T00:00:00Z'), end: iso('2026-07-18T00:00:00Z') }

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
  })

  it('inclui meus comentários e os de terceiros em cards meus; exclui alheios e fora do período', () => {
    upsertIssue(db, 1, baseIssue('BT-1'))
    upsertIssue(db, 1, baseIssue('BT-2', { assigneeAccountId: 'acc-outro', assigneeName: 'Outro' }))
    insertActivities(db, 1, [
      comment('BT-1', 'acc-qa', '2026-07-15T10:00:00Z', 'feedback de QA no meu card', 'c1'),
      comment('BT-2', ME, '2026-07-15T11:00:00Z', 'meu comentário em card alheio', 'c2'),
      comment('BT-2', 'acc-qa', '2026-07-15T12:00:00Z', 'conversa alheia em card alheio', 'c3'),
      comment('BT-1', ME, '2026-07-01T10:00:00Z', 'fora do período', 'c4')
    ])
    const out = collectPeriodComments(db, ws, range)
    expect(out.map((c) => c.texto).sort()).toEqual([
      'feedback de QA no meu card',
      'meu comentário em card alheio'
    ])
    // mais recente primeiro
    expect(out[0].texto).toBe('meu comentário em card alheio')
    expect(out[0].key).toBe('BT-2')
    expect(out[1].autor).toBe('Outro')
  })

  it('trunca texto longo e respeita o limite de itens', () => {
    upsertIssue(db, 1, baseIssue('BT-3'))
    insertActivities(db, 1, [
      comment('BT-3', ME, '2026-07-15T10:00:00Z', 'x'.repeat(500), 'c10'),
      comment('BT-3', ME, '2026-07-15T11:00:00Z', 'curto', 'c11'),
      comment('BT-3', ME, '2026-07-15T12:00:00Z', 'mais recente', 'c12')
    ])
    const out = collectPeriodComments(db, ws, range, { limit: 2, maxChars: 100 })
    expect(out).toHaveLength(2)
    expect(out[0].texto).toBe('mais recente')
    expect(out[1].texto).toBe('curto')
    const all = collectPeriodComments(db, ws, range, { maxChars: 100 })
    const longo = all.find((c) => c.texto.startsWith('xxx'))
    expect(longo?.texto.length).toBe(101) // 100 + '…'
  })

  it('comentário vazio não entra', () => {
    upsertIssue(db, 1, baseIssue('BT-4'))
    insertActivities(db, 1, [comment('BT-4', ME, '2026-07-15T10:00:00Z', '  ', 'c20')])
    expect(collectPeriodComments(db, ws, range)).toEqual([])
  })
})
