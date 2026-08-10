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

describe('JiraClient.boardConfiguration', () => {
  it('GET /rest/agile/1.0/board/{id}/configuration e mapeia columnConfig.columns -> {name, statusIds, wipMax}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        columnConfig: {
          columns: [
            {
              name: 'Em teste',
              statuses: [
                { id: '10004', self: 'https://x.atlassian.net/rest/api/3/status/10004' },
                { id: '10005', self: 'https://x.atlassian.net/rest/api/3/status/10005' }
              ]
            }
          ]
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = await makeClient().boardConfiguration(5)

    // coluna sem constraint configurada no board -> wipMax null (caso comum)
    expect(config).toEqual({
      columns: [{ name: 'Em teste', statusIds: ['10004', '10005'], wipMax: null }]
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://x.atlassian.net/rest/agile/1.0/board/5/configuration')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })

  it('coluna com constraint de WIP configurada -> wipMax vem de columnConfig.columns[].max', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        columnConfig: {
          columns: [
            {
              name: 'Em andamento',
              statuses: [{ id: '3' }],
              min: 1,
              max: 4
            }
          ]
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = await makeClient().boardConfiguration(5)

    expect(config).toEqual({
      columns: [{ name: 'Em andamento', statusIds: ['3'], wipMax: 4 }]
    })
  })
})

describe('JiraClient.listStatuses', () => {
  it('GET /rest/api/3/status e mapeia statusCategory.key -> categoryKey', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes([
        { id: '3', name: 'Em andamento', statusCategory: { key: 'indeterminate' } },
        { id: '10001', name: 'Concluído', statusCategory: { key: 'done' } }
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const statuses = await makeClient().listStatuses()

    expect(statuses).toEqual([
      { id: '3', name: 'Em andamento', categoryKey: 'indeterminate' },
      { id: '10001', name: 'Concluído', categoryKey: 'done' }
    ])
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://x.atlassian.net/rest/api/3/status')
  })
})

describe('JiraClient.issueTransitions', () => {
  it('GET /rest/api/3/issue/{key}/transitions e mapeia para BoardTransition[]', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        transitions: [
          {
            id: '31',
            name: 'Iniciar',
            to: { id: '3', name: 'Em andamento', statusCategory: { key: 'indeterminate' } }
          }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const transitions = await makeClient().issueTransitions('BT-1')

    expect(transitions).toEqual([
      {
        id: '31',
        name: 'Iniciar',
        toStatusId: '3',
        toStatusName: 'Em andamento',
        toCategoryKey: 'indeterminate'
      }
    ])
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/transitions')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET')
  })
})

describe('JiraClient.doTransition', () => {
  it('POST /rest/api/3/issue/{key}/transitions com body {transition: {id}}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().doTransition('BT-1', '31')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/transitions')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ transition: { id: '31' } })
  })
})
