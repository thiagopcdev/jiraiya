import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { insertMentions, listMentions, markAllRead, unreadCount } from './mentions'
import type { MentionInsert } from '../../sync/mentions'

const ME = 'acc-me'
const ANA = 'acc-ana'
const iso = (d: string): string => new Date(d).toISOString()

function mention(sourceId: string, over: Partial<MentionInsert> = {}): MentionInsert {
  return {
    issueKey: 'BT-1',
    sourceId,
    authorAccountId: ANA,
    authorName: 'Ana',
    excerpt: 'trecho do comentário',
    occurredAt: iso('2026-07-15T10:00:00Z'),
    ...over
  }
}

describe('repo de mentions', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', ?, 'now')`
    ).run(ME)
    db.prepare(
      `INSERT INTO issue (workspace_id, jira_id, key, project_key, summary)
       VALUES (1, '10001', 'BT-1', 'BT', 'Corrigir bug de login')`
    ).run()
  })

  it('insere 2 menções e listMentions traz as 2 com issueSummary e ordenação DESC por occurred_at', () => {
    const inserted = insertMentions(db, 1, [
      mention('comment:1', { occurredAt: iso('2026-07-15T10:00:00Z') }),
      mention('comment:2', { occurredAt: iso('2026-07-16T10:00:00Z') })
    ])
    expect(inserted).toHaveLength(2)

    const list = listMentions(db, 1)
    expect(list).toHaveLength(2)
    expect(list.map((m) => m.issueSummary)).toEqual([
      'Corrigir bug de login',
      'Corrigir bug de login'
    ])
    // DESC por occurred_at: comment:2 (16/07) antes de comment:1 (15/07)
    expect(list.map((m) => m.occurredAt)).toEqual([
      iso('2026-07-16T10:00:00Z'),
      iso('2026-07-15T10:00:00Z')
    ])
  })

  it('re-insert das mesmas menções (dedupe por source_id) retorna [] e mantém 2 no banco', () => {
    const mentions = [
      mention('comment:1'),
      mention('comment:2', { occurredAt: iso('2026-07-16T10:00:00Z') })
    ]
    insertMentions(db, 1, mentions)
    const second = insertMentions(db, 1, mentions)
    expect(second).toEqual([])
    expect(listMentions(db, 1)).toHaveLength(2)
  })

  it('insertMentions com markRead: true entra com readAt preenchido e não sobe unreadCount', () => {
    insertMentions(db, 1, [mention('comment:1')], { markRead: true })
    expect(unreadCount(db, 1)).toBe(0)
    const list = listMentions(db, 1)
    expect(list).toHaveLength(1)
    expect(list[0].readAt).not.toBeNull()
  })

  it('unreadCount conta não-lidas; markAllRead zera e listMentions reflete readAt preenchido', () => {
    insertMentions(db, 1, [mention('comment:1'), mention('comment:2')])
    expect(unreadCount(db, 1)).toBe(2)

    markAllRead(db, 1)
    expect(unreadCount(db, 1)).toBe(0)

    const list = listMentions(db, 1)
    expect(list.every((m) => m.readAt !== null)).toBe(true)
  })

  it('menção de issue inexistente no cache tem issueSummary null e não quebra', () => {
    insertMentions(db, 1, [mention('comment:9', { issueKey: 'BT-999' })])
    const list = listMentions(db, 1)
    expect(list).toHaveLength(1)
    expect(list[0].issueSummary).toBeNull()
  })
})
