import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient, discoverCustomFields } from './client'
import { JiraHttp } from './http'
import type { JiraCreateMetaIssueType, JiraFieldDef, JiraIssue } from './types'

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

describe('JiraClient.listCreateIssueTypes', () => {
  const issueType = (id: string): JiraCreateMetaIssueType => ({ id, name: `Tipo ${id}` })

  it('busca em /issue/createmeta/{key}/issuetypes com paginação inicial', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        startAt: 0,
        maxResults: 50,
        total: 2,
        issueTypes: [issueType('10001'), issueType('10002')]
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const types = await makeClient().listCreateIssueTypes('BT')

    expect(types).toEqual([issueType('10001'), issueType('10002')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/rest/api/3/issue/createmeta/BT/issuetypes?startAt=0&maxResults=50')
  })

  it('pagina e concatena quando total excede o tamanho da página (total=60: 50 + 10)', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => issueType(String(i)))
    const page2 = Array.from({ length: 10 }, (_, i) => issueType(String(50 + i)))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ startAt: 0, maxResults: 50, total: 60, issueTypes: page1 }))
      .mockResolvedValueOnce(jsonRes({ startAt: 50, maxResults: 50, total: 60, issueTypes: page2 }))
    vi.stubGlobal('fetch', fetchMock)

    const types = await makeClient().listCreateIssueTypes('BT')

    expect(types).toHaveLength(60)
    expect(types).toEqual([...page1, ...page2])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondUrl = fetchMock.mock.calls[1][0] as string
    expect(secondUrl).toContain('startAt=50')
  })
})

describe('JiraClient.createIssue', () => {
  it('faz POST em /rest/api/3/issue com body {fields} e retorna a issue criada', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        id: '10001',
        key: 'BT-123',
        self: 'https://x.atlassian.net/rest/api/3/issue/10001'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const fields = { summary: 'Nova task', project: { key: 'BT' } }
    const created = await makeClient().createIssue(fields)

    expect(created.key).toBe('BT-123')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toContain('/rest/api/3/issue')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ fields })
  })
})

describe('JiraClient.addComment', () => {
  it('faz POST em /rest/api/3/issue/BT-1/comment com body { body: <payload> }', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    const commentBody = { type: 'doc', version: 1, content: [] }
    await makeClient().addComment('BT-1', commentBody)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/comment')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ body: commentBody })
  })

  it('URL-encoda a key quando ela tem caractere especial (espaço)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().addComment('BT 1', { text: 'x' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe(
      `https://x.atlassian.net/rest/api/3/issue/${encodeURIComponent('BT 1')}/comment`
    )
  })
})

describe('JiraClient.issueExists', () => {
  it('200 -> true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ key: 'BT-1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().issueExists('BT-1')).resolves.toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://x.atlassian.net/rest/api/3/issue/BT-1?fields=summary'
    )
  })

  it('404 -> false (excluída ou sem acesso)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })))
    await expect(makeClient().issueExists('BT-907')).resolves.toBe(false)
  })

  it('401 propaga (é credencial, não card apagado)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))
    await expect(makeClient().issueExists('BT-1')).rejects.toThrow('Credenciais')
  })

  it('400 propaga', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
    await expect(makeClient().issueExists('BT-1')).rejects.toThrow('400')
  })
})

describe('JiraClient.unreachableIssueKeys', () => {
  it('devolve as keys que a BUSCA não alcança', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ issues: [{ key: 'BT-1' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().unreachableIssueKeys(['BT-1', 'BT-907'])).resolves.toEqual(['BT-907'])
    const [url, init] = fetchMock.mock.calls[0]
    // a pergunta é de ALCANCE (busca), não de existência (bulkfetch): card
    // arquivado responde 200 no bulkfetch e por isso nunca era purgado
    expect(String(url)).toContain('/rest/api/3/search/jql')
    expect(JSON.parse(init.body as string).jql).toBe('key in (BT-1,BT-907)')
  })

  it('compara sem diferenciar caixa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ issues: [{ key: 'bt-1' }] })))
    await expect(makeClient().unreachableIssueKeys(['BT-1'])).resolves.toEqual([])
  })

  it('lote de 80 em 80', async () => {
    const keys = Array.from({ length: 170 }, (_, i) => `BT-${i + 1}`)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ issues: keys.slice(0, 80).map((key) => ({ key })) }))
      .mockResolvedValueOnce(jsonRes({ issues: keys.slice(80, 160).map((key) => ({ key })) }))
      .mockResolvedValueOnce(jsonRes({ issues: keys.slice(160).map((key) => ({ key })) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().unreachableIssueKeys(keys)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('lote inteiro vazio é ignorado (mais provável falha sistêmica que 80 exclusões)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ issues: [] })))
    await expect(makeClient().unreachableIssueKeys(['BT-1', 'BT-2'])).resolves.toEqual([])
  })

  it('sem keys não chama o Jira', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(makeClient().unreachableIssueKeys([])).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
