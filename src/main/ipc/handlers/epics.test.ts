import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerEpicHandlers } = await import('./epics')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerEpicHandlers(t.ctx)
})

describe('epics:overview', () => {
  it('sem épicos → lista vazia', async () => {
    seedIssue(t.db, 'BT-1')
    const res = await invokeHandler('epics:overview', {})
    expect(res.ok && res.data.epics).toEqual([])
  })

  it('agrega total/done e pontos dos filhos do épico', async () => {
    seedIssue(t.db, 'BT-100', { issue_type: 'Epic', summary: 'Épico de login' })
    seedIssue(t.db, 'BT-101', {
      parent_key: 'BT-100',
      status_category: 'done',
      story_points: 3
    })
    seedIssue(t.db, 'BT-102', { parent_key: 'BT-100', story_points: 5 })

    const res = await invokeHandler('epics:overview', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.epics).toEqual([
      {
        key: 'BT-100',
        summary: 'Épico de login',
        status: 'To Do',
        statusCategory: 'new',
        url: 'https://x.atlassian.net/browse/BT-100',
        total: 2,
        done: 1,
        spTotal: 8,
        spDone: 3
      }
    ])
  })

  it('épicos concluídos vão para o fim da lista', async () => {
    seedIssue(t.db, 'BT-200', { issue_type: 'Epic', status_category: 'done' })
    seedIssue(t.db, 'BT-201', { issue_type: 'Epic' })

    const res = await invokeHandler('epics:overview', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.epics.map((e) => e.key)).toEqual(['BT-201', 'BT-200'])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('epics:overview', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
