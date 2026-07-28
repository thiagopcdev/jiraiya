import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClient } from '../../jira/client'
import type { JiraIssue } from '../../jira/types'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { JiraHttpError } = await import('../../jira/http')
const { registerFilterHandlers } = await import('./filters')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerFilterHandlers(t.ctx)
})

function rawIssue(key: string, over: Record<string, unknown> = {}): JiraIssue {
  return {
    id: `id-${key}`,
    key,
    fields: {
      summary: `Card ${key}`,
      project: { key: 'BT' },
      issuetype: { name: 'Task' },
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      updated: '2026-07-01T00:00:00.000Z',
      created: '2026-06-01T00:00:00.000Z',
      ...over
    }
  } as unknown as JiraIssue
}

/** Client falso que entrega `pages` ao callback de paginação do searchAll. */
function clientWithPages(pages: JiraIssue[][]): Partial<JiraClient> {
  return {
    searchAll: async (_jql, _fields, onPage) => {
      for (const page of pages) await onPage(page)
      return pages.reduce((n, p) => n + p.length, 0)
    }
  }
}

describe('filters:list / save / delete', () => {
  it('workspace novo → lista vazia', async () => {
    const res = await invokeHandler('filters:list', {})
    expect(res.ok && res.data.filters).toEqual([])
  })

  it('save sem id cria com position 0 e aparece no list', async () => {
    const created = await invokeHandler('filters:save', {
      name: 'Meus abertos',
      jql: 'assignee = currentUser()'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const list = await invokeHandler('filters:list', {})
    expect(list.ok && list.data.filters).toEqual([
      {
        id: created.data.id,
        name: 'Meus abertos',
        jql: 'assignee = currentUser()',
        position: 0
      }
    ])
  })

  it('save com id edita e devolve o mesmo id', async () => {
    const created = await invokeHandler('filters:save', { name: 'A', jql: 'a = 1' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const edited = await invokeHandler('filters:save', {
      id: created.data.id,
      name: 'B',
      jql: 'b = 2'
    })
    expect(edited.ok && edited.data.id).toBe(created.data.id)

    const list = await invokeHandler('filters:list', {})
    expect(list.ok && list.data.filters[0].name).toBe('B')
  })

  it('delete remove o filtro', async () => {
    const created = await invokeHandler('filters:save', { name: 'A', jql: 'a = 1' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const res = await invokeHandler('filters:delete', { id: created.data.id })
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('filters:list', {})
    expect(list.ok && list.data.filters).toEqual([])
  })

  it('jql vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('filters:save', { name: 'A', jql: '   ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('filters:run', () => {
  it('mapeia as issues cruas para o DTO com url de browse', async () => {
    t.setClient(clientWithPages([[rawIssue('BT-1')]]))

    const res = await invokeHandler('filters:run', { jql: 'project = BT' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.truncated).toBe(false)
    expect(res.data.issues).toHaveLength(1)
    expect(res.data.issues[0]).toMatchObject({
      key: 'BT-1',
      projectKey: 'BT',
      status: 'To Do',
      statusCategory: 'new',
      url: 'https://x.atlassian.net/browse/BT-1'
    })
  })

  it('passa os custom fields descobertos e ignora flagged = none', async () => {
    t.db
      .prepare(
        `UPDATE workspace SET story_points_field_id = 'customfield_1',
           sprint_field_id = 'customfield_2', flagged_field_id = 'none' WHERE id = 1`
      )
      .run()
    const fieldsSeen: string[][] = []
    t.setClient({
      searchAll: async (_jql, fields, onPage) => {
        fieldsSeen.push(fields)
        await onPage([rawIssue('BT-1', { customfield_1: 8 })])
        return 1
      }
    })

    const res = await invokeHandler('filters:run', { jql: 'project = BT' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(fieldsSeen[0]).toEqual(['customfield_1', 'customfield_2'])
    expect(res.data.issues[0].storyPoints).toBe(8)
  })

  it('mais resultados que o limit → truncated true e corta a lista', async () => {
    t.setClient(clientWithPages([[rawIssue('BT-1'), rawIssue('BT-2'), rawIssue('BT-3')]]))

    const res = await invokeHandler('filters:run', { jql: 'project = BT', limit: 2 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.truncated).toBe(true)
    expect(res.data.issues.map((i) => i.key)).toEqual(['BT-1', 'BT-2'])
  })

  it('400 do Jira → JQL_INVALID com a mensagem do corpo', async () => {
    t.setClient({
      searchAll: async () => {
        throw new JiraHttpError(
          400,
          'bad request',
          JSON.stringify({ errorMessages: ['Field xyz does not exist'] })
        )
      }
    })

    const res = await invokeHandler('filters:run', { jql: 'xyz = 1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JQL_INVALID')
    expect(res.message).toContain('Field xyz does not exist')
  })

  it('erro não-400 sobe como está', async () => {
    t.setClient({
      searchAll: async () => {
        throw new JiraHttpError(500, 'boom')
      }
    })

    const res = await invokeHandler('filters:run', { jql: 'project = BT' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JIRA_HTTP')
  })

  it('sem client conectado → NOT_CONNECTED', async () => {
    t.setClient(null)
    const res = await invokeHandler('filters:run', { jql: 'project = BT' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('sem workspace conectado', () => {
  beforeEach(() => {
    t.db.prepare('DELETE FROM workspace').run()
  })

  it('filters:list → NOT_CONNECTED', async () => {
    const res = await invokeHandler('filters:list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('filters:delete → NOT_CONNECTED', async () => {
    const res = await invokeHandler('filters:delete', { id: 1 })
    expect(res.ok).toBe(false)
  })
})
