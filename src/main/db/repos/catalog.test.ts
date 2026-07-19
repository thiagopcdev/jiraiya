import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { upsertSprints, listRecentSprints } from './catalog'

const iso = (d: string): string => new Date(d).toISOString()

describe('listRecentSprints', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', 'acc-me', 'now')`
    ).run()
  })

  it('exclui sprints com state = future', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sprint Futura',
        state: 'future',
        startDate: null,
        endDate: null,
        completeDate: null
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'Sprint Fechada',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T00:00:00Z'),
        completeDate: iso('2026-06-14T00:00:00Z')
      }
    ])
    const rows = listRecentSprints(db, 1, 10)
    expect(rows.map((r) => r.jiraId)).toEqual([2])
  })

  it('exclui sprints com start_date NULL mesmo que state seja active/closed', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Sem início',
        state: 'closed',
        startDate: null,
        endDate: iso('2026-06-14T00:00:00Z'),
        completeDate: iso('2026-06-14T00:00:00Z')
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'Com início',
        state: 'active',
        startDate: iso('2026-07-01T00:00:00Z'),
        endDate: null,
        completeDate: null
      }
    ])
    const rows = listRecentSprints(db, 1, 10)
    expect(rows.map((r) => r.jiraId)).toEqual([2])
  })

  it('ordena por start_date DESC', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'Antiga',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T00:00:00Z'),
        completeDate: iso('2026-06-14T00:00:00Z')
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'Nova',
        state: 'closed',
        startDate: iso('2026-06-29T00:00:00Z'),
        endDate: iso('2026-07-12T00:00:00Z'),
        completeDate: iso('2026-07-12T00:00:00Z')
      },
      {
        jiraId: 3,
        boardJiraId: 100,
        name: 'Meio',
        state: 'closed',
        startDate: iso('2026-06-15T00:00:00Z'),
        endDate: iso('2026-06-28T00:00:00Z'),
        completeDate: iso('2026-06-28T00:00:00Z')
      }
    ])
    const rows = listRecentSprints(db, 1, 10)
    expect(rows.map((r) => r.jiraId)).toEqual([2, 3, 1])
  })

  it('respeita o limit', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 1,
        boardJiraId: 100,
        name: 'S1',
        state: 'closed',
        startDate: iso('2026-06-01T00:00:00Z'),
        endDate: iso('2026-06-14T00:00:00Z'),
        completeDate: iso('2026-06-14T00:00:00Z')
      },
      {
        jiraId: 2,
        boardJiraId: 100,
        name: 'S2',
        state: 'closed',
        startDate: iso('2026-06-15T00:00:00Z'),
        endDate: iso('2026-06-28T00:00:00Z'),
        completeDate: iso('2026-06-28T00:00:00Z')
      },
      {
        jiraId: 3,
        boardJiraId: 100,
        name: 'S3',
        state: 'closed',
        startDate: iso('2026-06-29T00:00:00Z'),
        endDate: iso('2026-07-12T00:00:00Z'),
        completeDate: iso('2026-07-12T00:00:00Z')
      }
    ])
    const rows = listRecentSprints(db, 1, 2)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.jiraId)).toEqual([3, 2])
  })

  it('mapeia campos corretamente (completeDate, state, name, boardJiraId)', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 42,
        boardJiraId: 7,
        name: 'Sprint 42',
        state: 'active',
        startDate: iso('2026-07-01T00:00:00Z'),
        endDate: iso('2026-07-15T00:00:00Z'),
        completeDate: null
      }
    ])
    const rows = listRecentSprints(db, 1, 10)
    expect(rows).toEqual([
      {
        jiraId: 42,
        boardJiraId: 7,
        name: 'Sprint 42',
        state: 'active',
        startDate: iso('2026-07-01T00:00:00Z'),
        endDate: iso('2026-07-15T00:00:00Z'),
        completeDate: null
      }
    ])
  })
})
