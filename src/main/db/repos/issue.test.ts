import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import {
  allIssueKeys,
  getIssueByKey,
  listChildIssues,
  purgeIssue,
  rowToIssue,
  updateIssueFields,
  updateIssueStatus,
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

describe('status_id do card', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at)
       VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
    ).run()
  })

  it('upsert grava statusId e rowToIssue devolve', () => {
    upsertIssue(db, 1, baseIssue('BT-1', { statusId: '10001' }))
    const row = getIssueByKey(db, 1, 'BT-1')!
    expect(row.status_id).toBe('10001')
    expect(rowToIssue(row, 'https://x.atlassian.net').statusId).toBe('10001')
  })

  it('upsert sem statusId (fixture antiga) grava NULL em vez de estourar', () => {
    upsertIssue(db, 1, baseIssue('BT-2'))
    expect(getIssueByKey(db, 1, 'BT-2')!.status_id).toBeNull()
  })

  it('updateIssueStatus com id grava o id novo', () => {
    upsertIssue(db, 1, baseIssue('BT-3', { statusId: '10001' }))
    updateIssueStatus(db, 1, 'BT-3', 'Concluído', 'done', '10002')
    const row = getIssueByKey(db, 1, 'BT-3')!
    expect(row.status).toBe('Concluído')
    expect(row.status_id).toBe('10002')
  })

  it('updateIssueStatus sem id ZERA o status_id (id velho apontaria para a coluna errada)', () => {
    upsertIssue(db, 1, baseIssue('BT-4', { statusId: '10001' }))
    updateIssueStatus(db, 1, 'BT-4', 'Concluído', 'done')
    expect(getIssueByKey(db, 1, 'BT-4')!.status_id).toBeNull()
  })
})

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

describe('purgeIssue / allIssueKeys', () => {
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

  const seedSatellites = (key: string): void => {
    db.prepare(
      `INSERT INTO issue_activity (workspace_id, issue_key, kind, occurred_at, source_id)
       VALUES (1, ?, 'comment', '2026-07-01T00:00:00.000Z', ?)`
    ).run(key, `src-${key}`)
    db.prepare(
      `INSERT INTO mention (workspace_id, issue_key, source_id, author_account_id, occurred_at)
       VALUES (1, ?, ?, 'acc-other', '2026-07-01T00:00:00.000Z')`
    ).run(key, `m-${key}`)
    db.prepare(
      `INSERT INTO alert (workspace_id, rule_id, issue_key, severity, message, first_detected_at, last_seen_at)
       VALUES (1, 'stalled', ?, 'warning', 'parado', 'now', 'now')`
    ).run(key)
    db.prepare(`INSERT INTO watch (workspace_id, issue_key, created_at) VALUES (1, ?, 'now')`).run(
      key
    )
    db.prepare(
      `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at) VALUES (1, ?, 'minha nota', 'now')`
    ).run(key)
  }

  const count = (table: string, key: string): number =>
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = 1 AND issue_key = ?`)
        .get(key) as { n: number }
    ).n

  it('apaga o card e o que só existe por causa dele', () => {
    upsertIssue(db, 1, baseIssue('BT-907'))
    seedSatellites('BT-907')

    expect(purgeIssue(db, 1, 'BT-907')).toBe(true)
    expect(getIssueByKey(db, 1, 'BT-907')).toBeNull()
    expect(count('issue_activity', 'BT-907')).toBe(0)
    expect(count('mention', 'BT-907')).toBe(0)
    expect(count('alert', 'BT-907')).toBe(0)
    expect(count('watch', 'BT-907')).toBe(0)
  })

  it('preserva a nota privada (texto do usuário, não veio do Jira)', () => {
    upsertIssue(db, 1, baseIssue('BT-907'))
    seedSatellites('BT-907')
    purgeIssue(db, 1, 'BT-907')
    expect(count('issue_note', 'BT-907')).toBe(1)
  })

  it('não toca em outros cards nem em outro workspace', () => {
    upsertIssue(db, 1, baseIssue('BT-907'))
    upsertIssue(db, 1, baseIssue('BT-908'))
    upsertIssue(db, 2, baseIssue('BT-907'))
    seedSatellites('BT-908')

    purgeIssue(db, 1, 'BT-907')
    expect(getIssueByKey(db, 1, 'BT-908')).not.toBeNull()
    expect(getIssueByKey(db, 2, 'BT-907')).not.toBeNull()
    expect(count('issue_activity', 'BT-908')).toBe(1)
  })

  it('key inexistente -> false', () => {
    expect(purgeIssue(db, 1, 'BT-404')).toBe(false)
  })

  it('sai do índice de busca junto (trigger do FTS)', () => {
    upsertIssue(db, 1, baseIssue('BT-907', { summary: 'card fantasma' }))
    purgeIssue(db, 1, 'BT-907')
    const hits = db
      .prepare(`SELECT COUNT(*) AS n FROM issue_fts WHERE issue_fts MATCH 'fantasma'`)
      .get() as { n: number }
    expect(hits.n).toBe(0)
  })

  it('allIssueKeys devolve só as keys do workspace, ordenadas', () => {
    upsertIssue(db, 1, baseIssue('BT-2'))
    upsertIssue(db, 1, baseIssue('BT-1'))
    upsertIssue(db, 2, baseIssue('BT-9'))
    expect(allIssueKeys(db, 1)).toEqual(['BT-1', 'BT-2'])
  })
})
