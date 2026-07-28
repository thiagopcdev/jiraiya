import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerProjectHandlers } = await import('./projects')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerProjectHandlers(t.ctx)
})

const REMOTE_PROJECTS = [
  { id: '1', key: 'BT', name: 'Biud Tech', avatarUrls: { '24x24': 'https://x/av.png' } },
  { id: '2', key: 'OPS', name: 'Operações' }
]

describe('projects:list', () => {
  it('sem cache busca no Jira, grava e devolve o catálogo', async () => {
    let calls = 0
    t.setClient({
      listProjects: async () => {
        calls++
        return REMOTE_PROJECTS as never
      }
    })

    const res = await invokeHandler('projects:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(calls).toBe(1)
    expect(res.data.projects).toEqual([
      { jiraId: '1', key: 'BT', name: 'Biud Tech', avatarUrl: 'https://x/av.png', selected: false },
      { jiraId: '2', key: 'OPS', name: 'Operações', avatarUrl: null, selected: false }
    ])
  })

  it('com cache não chama o Jira de novo', async () => {
    let calls = 0
    t.setClient({
      listProjects: async () => {
        calls++
        return REMOTE_PROJECTS as never
      }
    })
    await invokeHandler('projects:list', {})
    const res = await invokeHandler('projects:list', {})
    expect(res.ok).toBe(true)
    expect(calls).toBe(1)
  })

  it('refresh true força nova busca mesmo com cache', async () => {
    let calls = 0
    t.setClient({
      listProjects: async () => {
        calls++
        return REMOTE_PROJECTS as never
      }
    })
    await invokeHandler('projects:list', {})
    await invokeHandler('projects:list', { refresh: true })
    expect(calls).toBe(2)
  })

  it('sem client e sem cache → NOT_CONNECTED', async () => {
    t.setClient(null)
    const res = await invokeHandler('projects:list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('projects:setSelected', () => {
  it('marca os selecionados e descobre os boards de cada projeto', async () => {
    t.setClient({
      listProjects: async () => REMOTE_PROJECTS as never,
      listBoards: async (key: string) =>
        [{ id: key === 'BT' ? 11 : 22, name: `Board ${key}`, type: 'scrum' }] as never
    })
    await invokeHandler('projects:list', {})

    const res = await invokeHandler('projects:setSelected', { keys: ['BT'] })
    expect(res.ok && res.data).toEqual({ ok: true })

    const projects = await invokeHandler('projects:list', {})
    expect(projects.ok).toBe(true)
    if (!projects.ok) return
    expect(projects.data.projects.filter((p) => p.selected).map((p) => p.key)).toEqual(['BT'])

    const boards = await invokeHandler('boards:list', {})
    expect(boards.ok && boards.data.boards).toEqual([
      { jiraId: 11, name: 'Board BT', type: 'scrum', projectKey: 'BT' }
    ])
  })

  it('projeto sem board (erro do Jira) não derruba a seleção', async () => {
    t.setClient({
      listBoards: async () => {
        throw new Error('service desk não tem board')
      }
    })
    const res = await invokeHandler('projects:setSelected', { keys: ['BT'] })
    expect(res.ok && res.data).toEqual({ ok: true })
  })

  it('sem client apenas grava a seleção local', async () => {
    t.setClient(null)
    const res = await invokeHandler('projects:setSelected', { keys: ['BT'] })
    expect(res.ok && res.data).toEqual({ ok: true })
  })
})

describe('boards:list', () => {
  it('sem boards → lista vazia', async () => {
    const res = await invokeHandler('boards:list', {})
    expect(res.ok && res.data.boards).toEqual([])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('boards:list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
