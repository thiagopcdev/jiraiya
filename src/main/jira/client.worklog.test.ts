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

describe('JiraClient.listWorklogs', () => {
  it('GET .../issue/BT-1/worklog e retorna body.worklogs', async () => {
    const worklog = {
      id: '1',
      author: { accountId: 'a', displayName: 'Ana' },
      started: '2026-07-01T10:00:00Z',
      timeSpent: '1h',
      timeSpentSeconds: 3600
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ worklogs: [worklog] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().listWorklogs('BT-1')

    expect(result).toEqual([worklog])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issue/BT-1/worklog')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('worklogs vazio -> []', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ worklogs: [] }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await makeClient().listWorklogs('BT-1')).toEqual([])
  })
})

describe('JiraClient.updateWorklog', () => {
  it('PUT .../issue/BT-1/worklog/7 com body {timeSpent} e sem campo comment', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().updateWorklog('BT-1', '7', '2h', undefined)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issue/BT-1/worklog/7')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>
    expect(body.timeSpent).toBe('2h')
    expect(body.comment).toBeUndefined()
  })
})

describe('JiraClient.deleteWorklog', () => {
  it('DELETE na mesma URL do worklog', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().deleteWorklog('BT-1', '7')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issue/BT-1/worklog/7')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})

describe('JiraClient.listIssueLinkTypes', () => {
  it('GET .../issueLinkType mapeando {id, name, inward, outward}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        issueLinkTypes: [
          { id: '10', name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().listIssueLinkTypes()

    expect(result).toEqual([
      { id: '10', name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' }
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issueLinkType')
    expect((init as RequestInit).method).toBe('GET')
  })
})

describe('JiraClient.createIssueLink', () => {
  it('POST .../issueLink com body {type, inwardIssue, outwardIssue}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().createIssueLink('Blocks', 'BT-2', 'BT-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issueLink')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      type: { name: 'Blocks' },
      inwardIssue: { key: 'BT-2' },
      outwardIssue: { key: 'BT-1' }
    })
  })
})

describe('JiraClient.moveIssuesToSprint', () => {
  it('POST em URL contendo /rest/agile/1.0/sprint/42/issue com body {issues}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().moveIssuesToSprint(42, ['BT-1'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/agile/1.0/sprint/42/issue')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ issues: ['BT-1'] })
  })
})

describe('JiraClient.moveIssuesToBacklog', () => {
  it('POST /rest/agile/1.0/backlog/issue com body {issues}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().moveIssuesToBacklog(['BT-1'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/agile/1.0/backlog/issue')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ issues: ['BT-1'] })
  })
})
