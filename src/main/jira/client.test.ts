import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient, discoverCustomFields } from './client'
import { JiraHttp } from './http'
import type { JiraFieldDef, JiraIssue } from './types'

const jsonRes = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const makeClient = (): JiraClient =>
  new JiraClient(
    new JiraHttp({ siteUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' })
  )

const issue = (key: string): JiraIssue => ({ id: key, key, fields: { summary: key } })

afterEach(() => vi.unstubAllGlobals())

describe('JiraClient.searchAll', () => {
  it('pagina por nextPageToken até a última página', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ issues: [issue('BT-1'), issue('BT-2')], nextPageToken: 'tok-2' })
      )
      .mockResolvedValueOnce(jsonRes({ issues: [issue('BT-3')] }))
    vi.stubGlobal('fetch', fetchMock)

    const pages: string[][] = []
    const total = await makeClient().searchAll('project = BT', ['customfield_1'], (page) => {
      pages.push(page.map((i) => i.key))
    })

    expect(total).toBe(3)
    expect(pages).toEqual([['BT-1', 'BT-2'], ['BT-3']])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(firstBody.nextPageToken).toBeUndefined()
    expect(firstBody.fields).toContain('customfield_1')
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.nextPageToken).toBe('tok-2')
  })

  it('para quando a página vem vazia', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ issues: [], nextPageToken: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const total = await makeClient().searchAll('project = BT', [], () => {
      throw new Error('não deveria chamar onPage com página vazia')
    })
    expect(total).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('discoverCustomFields', () => {
  const field = (id: string, name: string, custom: string | undefined): JiraFieldDef => ({
    id,
    name,
    custom: true,
    schema: custom ? { custom } : undefined
  })

  it('descobre story points, sprint e flagged', () => {
    const out = discoverCustomFields([
      field('customfield_10016', 'Story point estimate', 'x:storypoint'),
      field('customfield_10020', 'Sprint', 'com.pyxis.greenhopper.jira:gh-sprint'),
      field(
        'customfield_10021',
        'Flagged',
        'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes'
      )
    ])
    expect(out).toEqual({
      storyPointsFieldId: 'customfield_10016',
      sprintFieldId: 'customfield_10020',
      flaggedFieldId: 'customfield_10021'
    })
  })

  it('flagged com nome localizado (Impedimento) também é encontrado', () => {
    const out = discoverCustomFields([
      field(
        'customfield_99',
        'Impedimento',
        'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes'
      )
    ])
    expect(out.flaggedFieldId).toBe('customfield_99')
  })

  it('multicheckbox sem cara de flag não é confundido', () => {
    const out = discoverCustomFields([
      field(
        'customfield_50',
        'Ambientes afetados',
        'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes'
      )
    ])
    expect(out.flaggedFieldId).toBeNull()
  })
})
