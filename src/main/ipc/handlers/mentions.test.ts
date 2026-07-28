import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { insertMentions } = await import('../../db/repos/mentions')
const { registerMentionHandlers } = await import('./mentions')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerMentionHandlers(t.ctx)
})

function seedMention(sourceId: string, opts: { markRead?: boolean } = {}): void {
  insertMentions(
    t.db,
    1,
    [
      {
        issueKey: 'BT-1',
        sourceId,
        authorAccountId: 'acc-2',
        authorName: 'Colega',
        excerpt: `@Eu Mesmo olha isso (${sourceId})`,
        occurredAt: '2026-07-20T10:00:00.000Z'
      }
    ],
    opts
  )
}

describe('mentions:list', () => {
  it('sem menções → lista vazia e zero não lidas', async () => {
    const res = await invokeHandler('mentions:list', {})
    expect(res.ok && res.data).toEqual({ mentions: [], unreadCount: 0 })
  })

  it('devolve as menções com o resumo do card e a contagem de não lidas', async () => {
    seedIssue(t.db, 'BT-1', { summary: 'Card mencionado' })
    seedMention('c-1')
    seedMention('c-2', { markRead: true })

    const res = await invokeHandler('mentions:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.mentions).toHaveLength(2)
    expect(res.data.mentions[0].issueSummary).toBe('Card mencionado')
    expect(res.data.unreadCount).toBe(1)
  })

  it('sem workspace → responde vazio em vez de erro', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('mentions:list', {})
    expect(res.ok && res.data).toEqual({ mentions: [], unreadCount: 0 })
  })
})

describe('mentions:markAllRead', () => {
  it('zera a contagem de não lidas', async () => {
    seedMention('c-1')
    const res = await invokeHandler('mentions:markAllRead', {})
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('mentions:list', {})
    expect(list.ok && list.data.unreadCount).toBe(0)
  })

  it('sem workspace ainda responde ok (no-op)', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('mentions:markAllRead', {})
    expect(res.ok && res.data).toEqual({ ok: true })
  })
})
