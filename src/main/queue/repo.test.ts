import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import {
  enqueueAction,
  listActions,
  markFailed,
  markInflight,
  markPendingAgain,
  nextPendingByIssue,
  queueCounts,
  removeAction,
  toPendingAction
} from './repo'

function insertWorkspace(db: Database.Database, id: number, accountId: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, 'https://x.atlassian.net', 'e@x.com', @accountId, 'now')`
  ).run({ id, accountId })
}

describe('repo da fila offline (pending_action)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1, 'acc-1')
    insertWorkspace(db, 2, 'acc-2')
  })

  it('enqueueAction cria row pending, attempts 0, local_uuid único e payload em JSON', () => {
    const row1 = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'transition',
      payload: { summary: 'Mover para Em andamento' }
    })
    const row2 = enqueueAction(db, 1, {
      issueKey: 'BT-2',
      type: 'comment',
      payload: { summary: 'Comentar' }
    })

    expect(row1.status).toBe('pending')
    expect(row1.attempts).toBe(0)
    expect(row1.local_uuid).not.toBe(row2.local_uuid)
    expect(JSON.parse(row1.payload)).toEqual({ summary: 'Mover para Em andamento' })
  })

  it('listActions ordena por id ASC e traz todos os status', () => {
    const a = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    const b = enqueueAction(db, 1, { issueKey: 'BT-2', type: 'worklog', payload: {} })
    markFailed(db, a.id, 'deu ruim')

    const rows = listActions(db, 1)
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id])
    expect(rows[0].status).toBe('failed')
    expect(rows[1].status).toBe('pending')
  })

  it('nextPendingByIssue agrupa por issue_key em ordem de id e exclui inflight/failed', () => {
    const a1 = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    const b1 = enqueueAction(db, 1, { issueKey: 'BT-2', type: 'comment', payload: {} })
    const a2 = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'worklog', payload: {} })
    const inflightAction = enqueueAction(db, 1, { issueKey: 'BT-2', type: 'update', payload: {} })
    const failedAction = enqueueAction(db, 1, { issueKey: 'BT-3', type: 'comment', payload: {} })
    markInflight(db, inflightAction.id)
    markFailed(db, failedAction.id, 'x')

    const grouped = nextPendingByIssue(db, 1)

    expect(Array.from(grouped.keys()).sort()).toEqual(['BT-1', 'BT-2'])
    expect(grouped.get('BT-1')?.map((r) => r.id)).toEqual([a1.id, a2.id])
    expect(grouped.get('BT-2')?.map((r) => r.id)).toEqual([b1.id])
    expect(grouped.has('BT-3')).toBe(false)
  })

  it('markInflight marca status inflight', () => {
    const row = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    markInflight(db, row.id)

    const [found] = listActions(db, 1)
    expect(found.status).toBe('inflight')
  })

  it('markPendingAgain volta para pending, incrementa attempts e grava last_error', () => {
    const row = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    markInflight(db, row.id)
    markPendingAgain(db, row.id, 'timeout de rede')

    const [found] = listActions(db, 1)
    expect(found.status).toBe('pending')
    expect(found.attempts).toBe(1)
    expect(found.last_error).toBe('timeout de rede')

    markInflight(db, row.id)
    markPendingAgain(db, row.id, 'timeout de novo')
    const [foundAgain] = listActions(db, 1)
    expect(foundAgain.attempts).toBe(2)
  })

  it('markFailed marca status failed, incrementa attempts e grava last_error', () => {
    const row = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    markFailed(db, row.id, 'erro definitivo')

    const [found] = listActions(db, 1)
    expect(found.status).toBe('failed')
    expect(found.attempts).toBe(1)
    expect(found.last_error).toBe('erro definitivo')
  })

  it('removeAction remove a linha', () => {
    const row = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    removeAction(db, row.id)

    expect(listActions(db, 1)).toEqual([])
  })

  it('queueCounts conta inflight como pending e failed separado', () => {
    const pendingRow = enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    const inflightRow = enqueueAction(db, 1, { issueKey: 'BT-2', type: 'comment', payload: {} })
    const failedRow = enqueueAction(db, 1, { issueKey: 'BT-3', type: 'comment', payload: {} })
    markInflight(db, inflightRow.id)
    markFailed(db, failedRow.id, 'x')
    void pendingRow

    expect(queueCounts(db, 1)).toEqual({ pending: 2, failed: 1 })
  })

  it('queueCounts em workspace sem ações devolve zeros', () => {
    expect(queueCounts(db, 1)).toEqual({ pending: 0, failed: 0 })
  })

  it('toPendingAction extrai summary do payload e mapeia os campos', () => {
    const row = enqueueAction(db, 1, {
      issueKey: 'BT-9',
      type: 'transition',
      payload: { summary: 'Mover para Concluído' }
    })
    markPendingAgain(db, row.id, 'falhou uma vez')
    const [updated] = listActions(db, 1)

    const dto = toPendingAction(updated)
    expect(dto).toEqual({
      id: row.id,
      issueKey: 'BT-9',
      type: 'transition',
      summary: 'Mover para Concluído',
      status: 'pending',
      attempts: 1,
      lastError: 'falhou uma vez',
      createdAt: row.created_at
    })
  })

  it('fila é isolada por workspace_id', () => {
    enqueueAction(db, 1, { issueKey: 'BT-1', type: 'comment', payload: {} })
    enqueueAction(db, 2, { issueKey: 'BT-9', type: 'comment', payload: {} })

    expect(listActions(db, 1)).toHaveLength(1)
    expect(listActions(db, 2)).toHaveLength(1)
    expect(listActions(db, 1)[0].issue_key).toBe('BT-1')
    expect(queueCounts(db, 1)).toEqual({ pending: 1, failed: 0 })
  })
})
