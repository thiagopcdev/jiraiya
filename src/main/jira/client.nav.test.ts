import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './client'
import { JiraHttp } from './http'

const jsonRes = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const makeClient = (): JiraClient =>
  new JiraClient(
    new JiraHttp({ siteUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' })
  )

afterEach(() => vi.unstubAllGlobals())

describe('JiraClient.assignableUsers', () => {
  it('GET /rest/api/3/user/assignable/search?issueKey=BT-1&maxResults=50 e mapeia {accountId, displayName}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes([
        { accountId: 'acc-1', displayName: 'Fulano', active: true },
        { accountId: 'acc-2', displayName: 'Beltrano', active: true }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const users = await makeClient().assignableUsers('BT-1')

    expect(users).toEqual([
      { accountId: 'acc-1', displayName: 'Fulano' },
      { accountId: 'acc-2', displayName: 'Beltrano' }
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe(
      'https://x.atlassian.net/rest/api/3/user/assignable/search?issueKey=BT-1&maxResults=50'
    )
    expect((init as RequestInit).method).toBe('GET')
  })

  it('usuário com active: false é filtrado fora', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes([
        { accountId: 'acc-1', displayName: 'Ativo', active: true },
        { accountId: 'acc-2', displayName: 'Inativo', active: false }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const users = await makeClient().assignableUsers('BT-1')

    expect(users).toEqual([{ accountId: 'acc-1', displayName: 'Ativo' }])
  })

  it('displayName ausente -> usa accountId', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes([{ accountId: 'acc-3', active: true }]))
    vi.stubGlobal('fetch', fetchMock)

    const users = await makeClient().assignableUsers('BT-1')

    expect(users).toEqual([{ accountId: 'acc-3', displayName: 'acc-3' }])
  })

  it('resposta vazia -> []', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes([]))
    vi.stubGlobal('fetch', fetchMock)

    expect(await makeClient().assignableUsers('BT-1')).toEqual([])
  })
})

describe('JiraClient.issueLinks', () => {
  it('GET /rest/api/3/issue/BT-1?fields=issuelinks e retorna fields.issuelinks cru', async () => {
    const raw = [
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        outwardIssue: { key: 'BT-2', fields: { summary: 'X', status: { name: 'A Fazer' } } }
      }
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ fields: { issuelinks: raw } }))
    vi.stubGlobal('fetch', fetchMock)

    const links = await makeClient().issueLinks('BT-1')

    expect(links).toEqual(raw)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1?fields=issuelinks')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('fields.issuelinks ausente -> []', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ fields: {} }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await makeClient().issueLinks('BT-1')).toEqual([])
  })

  it('fields ausente -> []', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    expect(await makeClient().issueLinks('BT-1')).toEqual([])
  })
})
