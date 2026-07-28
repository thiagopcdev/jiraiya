import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { upsertSprints } = await import('../../db/repos/catalog')
const { registerTrendHandlers } = await import('./trends')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerTrendHandlers(t.ctx)
})

describe('team:trends', () => {
  it('sem sprints fechadas → lista vazia', async () => {
    const res = await invokeHandler('team:trends', {})
    expect(res.ok && res.data.sprints).toEqual([])
  })

  it('agrega a entrega da sprint fechada pela janela de resolved_at', async () => {
    upsertSprints(t.db, 1, [
      {
        jiraId: 10,
        boardJiraId: 1,
        name: 'Sprint 1',
        state: 'closed',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-15T00:00:00.000Z',
        completeDate: '2026-06-15T00:00:00.000Z'
      }
    ])
    seedIssue(t.db, 'BT-1', {
      story_points: 5,
      created_at: '2026-06-02T00:00:00.000Z',
      resolved_at: '2026-06-10T00:00:00.000Z'
    })

    const res = await invokeHandler('team:trends', { sprintCount: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.sprints).toHaveLength(1)
    expect(res.data.sprints[0]).toMatchObject({ jiraId: 10, name: 'Sprint 1' })
  })

  it('sprintCount fora do range → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('team:trends', { sprintCount: 99 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('team:trends', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
