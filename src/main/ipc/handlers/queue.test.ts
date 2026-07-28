import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { enqueueAction } = await import('../../queue/repo')
const { registerQueueHandlers } = await import('./queue')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerQueueHandlers(t.ctx)
})

function enqueueComment(issueKey = 'BT-1', summary = 'Meu comentário'): number {
  return enqueueAction(t.db, 1, {
    issueKey,
    type: 'comment',
    payload: { summary, body: 'texto' }
  }).id
}

function markFailedRow(id: number, error = 'Jira recusou'): void {
  t.db
    .prepare(`UPDATE pending_action SET status = 'failed', last_error = ? WHERE id = ?`)
    .run(error, id)
}

describe('queue:list', () => {
  it('fila vazia → lista vazia', async () => {
    const res = await invokeHandler('queue:list', {})
    expect(res.ok && res.data.actions).toEqual([])
  })

  it('devolve as ações mais antigas primeiro, com summary do payload', async () => {
    enqueueComment('BT-1', 'primeiro')
    enqueueComment('BT-2', 'segundo')

    const res = await invokeHandler('queue:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.actions.map((a) => a.summary)).toEqual(['primeiro', 'segundo'])
    expect(res.data.actions[0]).toMatchObject({
      issueKey: 'BT-1',
      type: 'comment',
      status: 'pending',
      attempts: 0,
      lastError: null
    })
  })

  it('payload sem summary cai no rótulo do tipo', async () => {
    enqueueAction(t.db, 1, { issueKey: 'BT-9', type: 'worklog', payload: {} })
    const res = await invokeHandler('queue:list', {})
    expect(res.ok && res.data.actions[0].summary).toBe('Apontamento')
  })
})

describe('queue:retry', () => {
  it('sem id devolve todas as falhas para pending e avisa o badge', async () => {
    const failed = enqueueComment('BT-1')
    markFailedRow(failed)

    const res = await invokeHandler('queue:retry', {})
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('queue:list', {})
    expect(list.ok && list.data.actions[0].status).toBe('pending')
    expect(list.ok && list.data.actions[0].lastError).toBeNull()
    expect(t.pushes.map((p) => p.channel)).toContain('push:queue-changed')
    expect(t.pushes[0].payload).toEqual({ pending: 1, failed: 0 })
  })

  it('com id de ação falhada volta apenas ela para pending', async () => {
    const a = enqueueComment('BT-1', 'a')
    const b = enqueueComment('BT-2', 'b')
    markFailedRow(a)
    markFailedRow(b)

    const res = await invokeHandler('queue:retry', { id: a })
    expect(res.ok).toBe(true)

    const list = await invokeHandler('queue:list', {})
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.data.actions.find((x) => x.id === a)?.status).toBe('pending')
    expect(list.data.actions.find((x) => x.id === b)?.status).toBe('failed')
  })

  it('com id de ação já pendente é no-op bem-sucedido', async () => {
    const id = enqueueComment()
    const res = await invokeHandler('queue:retry', { id })
    expect(res.ok && res.data).toEqual({ ok: true })
  })

  it('id inexistente → NOT_FOUND', async () => {
    const res = await invokeHandler('queue:retry', { id: 4242 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_FOUND')
  })

  it('com client conectado o drain envia a ação e ela sai da fila', async () => {
    const sent: string[] = []
    t.setClient({
      addComment: async (key: string) => {
        sent.push(key)
      }
    })
    enqueueComment('BT-5')

    const res = await invokeHandler('queue:retry', {})
    expect(res.ok).toBe(true)
    expect(sent).toEqual(['BT-5'])

    const list = await invokeHandler('queue:list', {})
    expect(list.ok && list.data.actions).toEqual([])
  })
})

describe('queue:discard', () => {
  it('ação pendente é revertida no cache local e removida', async () => {
    seedIssue(t.db, 'BT-1', { status: 'Em andamento', status_category: 'indeterminate' })
    const id = enqueueAction(t.db, 1, {
      issueKey: 'BT-1',
      type: 'transition',
      payload: {
        summary: 'Mover para Concluído',
        transitionId: '31',
        toStatusName: 'Concluído',
        toCategoryKey: 'done',
        revert: { status: 'To Do', category: 'new' }
      }
    }).id

    const res = await invokeHandler('queue:discard', { id })
    expect(res.ok && res.data).toEqual({ ok: true })

    const row = t.db.prepare('SELECT status FROM issue WHERE key = ?').get('BT-1') as {
      status: string
    }
    expect(row.status).toBe('To Do')

    const list = await invokeHandler('queue:list', {})
    expect(list.ok && list.data.actions).toEqual([])
  })

  it('ação já falhada é só removida (o drain já reverteu)', async () => {
    const id = enqueueComment()
    markFailedRow(id)

    const res = await invokeHandler('queue:discard', { id })
    expect(res.ok).toBe(true)
    expect(t.pushes[0].payload).toEqual({ pending: 0, failed: 0 })
  })

  it('id inexistente → NOT_FOUND', async () => {
    const res = await invokeHandler('queue:discard', { id: 999 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_FOUND')
  })
})

describe('sem workspace conectado', () => {
  beforeEach(() => {
    t.db.prepare('DELETE FROM workspace').run()
  })

  it('queue:list → NOT_CONNECTED', async () => {
    const res = await invokeHandler('queue:list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('queue:retry → NOT_CONNECTED', async () => {
    const res = await invokeHandler('queue:retry', {})
    expect(res.ok).toBe(false)
  })

  it('queue:discard → NOT_CONNECTED', async () => {
    const res = await invokeHandler('queue:discard', { id: 1 })
    expect(res.ok).toBe(false)
  })
})
