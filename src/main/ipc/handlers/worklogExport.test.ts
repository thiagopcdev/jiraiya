import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClient } from '../../jira/client'
import type { JiraIssue, JiraWorklog } from '../../jira/types'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { JiraHttpError } = await import('../../jira/http')
const { registerWorklogExportHandlers } = await import('./worklogExport')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerWorklogExportHandlers(t.ctx)
})

function rawIssue(key: string, summary?: string): JiraIssue {
  return { id: `id-${key}`, key, fields: summary ? { summary } : {} } as unknown as JiraIssue
}

function worklog(over: Partial<JiraWorklog> = {}): JiraWorklog {
  return {
    id: 'w-1',
    author: { accountId: 'me-1' },
    started: '2026-07-20T09:00:00.000-0300',
    timeSpent: '2h',
    timeSpentSeconds: 7200,
    comment: null,
    ...over
  }
}

function client(
  issues: JiraIssue[],
  worklogsByKey: Record<string, JiraWorklog[] | Error>
): Partial<JiraClient> {
  return {
    searchAll: async (_jql, _fields, onPage) => {
      await onPage(issues)
      return issues.length
    },
    listWorklogs: async (key: string) => {
      const found = worklogsByKey[key]
      if (found instanceof Error) throw found
      return found ?? []
    }
  }
}

const RANGE = { start: '2026-07-20', end: '2026-07-21' }

describe('worklog:export', () => {
  it('agrega os worklogs do usuário no período, ordenados pelo instante real', async () => {
    t.setClient(
      client([rawIssue('BT-1', 'Card um'), rawIssue('BT-2', 'Card dois')], {
        'BT-1': [worklog({ started: '2026-07-21T15:00:00.000-0300', timeSpentSeconds: 1800 })],
        'BT-2': [worklog({ started: '2026-07-20T09:00:00.000-0300', timeSpentSeconds: 7200 })]
      })
    )

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.rows.map((r) => r.key)).toEqual(['BT-2', 'BT-1'])
    expect(res.data.rows[0]).toMatchObject({
      key: 'BT-2',
      summary: 'Card dois',
      timeSpent: '2h',
      seconds: 7200,
      comment: null
    })
    expect(res.data.totalSeconds).toBe(9000)
  })

  it('worklog de outro autor e fora do período são ignorados', async () => {
    t.setClient(
      client([rawIssue('BT-1', 'Card um')], {
        'BT-1': [
          worklog({ author: { accountId: 'outro' } }),
          worklog({ started: '2026-07-01T09:00:00.000-0300' }),
          worklog({ started: 'data-invalida' })
        ]
      })
    )

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok && res.data).toEqual({ rows: [], totalSeconds: 0 })
  })

  it('comentário ADF é convertido em texto; vazio vira null', async () => {
    t.setClient(
      client([rawIssue('BT-1', 'Card um')], {
        'BT-1': [
          worklog({
            id: 'w-a',
            comment: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ajuste no CSS' }] }]
            },
            started: '2026-07-20T08:00:00.000-0300'
          }),
          worklog({ id: 'w-b', started: '2026-07-20T10:00:00.000-0300' })
        ]
      })
    )

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.rows.map((r) => r.comment)).toEqual(['ajuste no CSS', null])
  })

  it('issue sem summary usa a própria key como resumo', async () => {
    t.setClient(client([rawIssue('BT-9')], { 'BT-9': [worklog()] }))

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok && res.data.rows[0].summary).toBe('BT-9')
  })

  it('issue inacessível no listWorklogs não derruba o export', async () => {
    t.setClient(
      client([rawIssue('BT-1', 'Sem permissão'), rawIssue('BT-2', 'Ok')], {
        'BT-1': new Error('403'),
        'BT-2': [worklog()]
      })
    )

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.rows.map((r) => r.key)).toEqual(['BT-2'])
  })

  it('para de paginar ao atingir o teto de 100 issues', async () => {
    const many = Array.from({ length: 150 }, (_, i) => rawIssue(`BT-${i + 1}`, `Card ${i + 1}`))
    let pages = 0
    t.setClient({
      searchAll: async (_jql, _fields, onPage) => {
        pages++
        await onPage(many)
        pages++
        await onPage(many)
        return many.length * 2
      },
      listWorklogs: async () => []
    })

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok && res.data.rows).toEqual([])
    // a primeira página já estourou o teto: a segunda nunca é pedida
    expect(pages).toBe(1)
  })

  it('400 do Jira na busca → JQL_INVALID', async () => {
    t.setClient({
      searchAll: async () => {
        throw new JiraHttpError(400, 'bad jql')
      }
    })

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JQL_INVALID')
  })

  it('erro não-400 sobe como JIRA_HTTP', async () => {
    t.setClient({
      searchAll: async () => {
        throw new JiraHttpError(503, 'indisponível')
      }
    })

    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JIRA_HTTP')
  })

  it('sem client → NOT_CONNECTED', async () => {
    t.setClient(null)
    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('worklog:export', RANGE)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('data fora do formato YYYY-MM-DD → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('worklog:export', { start: '20/07/2026', end: '2026-07-21' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
