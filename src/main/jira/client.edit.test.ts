import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './client'
import { JiraHttp } from './http'

const jsonRes = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const noContentRes = (): Response => new Response(null, { status: 204 })

const makeClient = (): JiraClient =>
  new JiraClient(
    new JiraHttp({ siteUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' })
  )

afterEach(() => vi.unstubAllGlobals())

describe('JiraClient.issueEditMeta', () => {
  it('GET /rest/api/3/issue/BT-1/editmeta e retorna o body cru', async () => {
    const raw = {
      fields: {
        priority: { name: 'Priority', allowedValues: [{ id: '1', name: 'Alta' }] }
      }
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes(raw))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().issueEditMeta('BT-1')

    expect(result).toEqual(raw)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/editmeta')
    expect((init as RequestInit).method).toBe('GET')
  })
})

describe('JiraClient.updateIssue', () => {
  it('PUT /rest/api/3/issue/BT-1 com body {fields: {priority: {id}}}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().updateIssue('BT-1', { priority: { id: '2' } })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fields: { priority: { id: '2' } }
    })
  })

  it('PUT com body {fields: {timetracking: {originalEstimate}}} (outro shape de fields)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().updateIssue('BT-1', { timetracking: { originalEstimate: '2d' } })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      fields: { timetracking: { originalEstimate: '2d' } }
    })
  })
})

describe('JiraClient.addWorklog', () => {
  it('POST /rest/api/3/issue/BT-1/worklog com body {timeSpent}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().addWorklog('BT-1', '1h 30m')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/worklog')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ timeSpent: '1h 30m' })
  })

  it('com comentário ADF → body inclui comment: <adf>', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    const commentAdf = { type: 'doc', version: 1, content: [] }
    await makeClient().addWorklog('BT-1', '1h 30m', commentAdf)

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      timeSpent: '1h 30m',
      comment: commentAdf
    })
  })
})

describe('JiraClient.issueTimeTracking', () => {
  it('GET /rest/api/3/issue/BT-1?fields=timetracking mapeia timeSpent e originalEstimate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ fields: { timetracking: { timeSpent: '3h', originalEstimate: '1d' } } })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().issueTimeTracking('BT-1')

    expect(result).toEqual({ timeSpent: '3h', originalEstimate: '1d' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1?fields=timetracking')
  })

  it('timetracking vazio {} → {timeSpent: null, originalEstimate: null}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ fields: { timetracking: {} } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().issueTimeTracking('BT-1')

    expect(result).toEqual({ timeSpent: null, originalEstimate: null })
  })
})
