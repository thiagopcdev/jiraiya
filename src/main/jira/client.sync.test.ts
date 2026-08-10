import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './client'
import { JiraHttp } from './http'
import type { JiraChangelogHistory, JiraComment } from './types'

/**
 * Cobre os métodos do client usados pelo sync (paginação de changelog,
 * comentários, projetos/boards/sprints) e o upload de anexo.
 */

const jsonRes = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const makeClient = (): JiraClient =>
  new JiraClient(
    new JiraHttp({ siteUrl: 'https://x.atlassian.net/', email: 'a@b.c', apiToken: 't' })
  )

function urlsOf(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => String(c[0]))
}

afterEach(() => vi.unstubAllGlobals())

describe('JiraClient.myself / listFields', () => {
  it('myself devolve o corpo cru do /myself com Basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ accountId: 'acc-1', displayName: 'Eu' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().myself()).resolves.toEqual({
      accountId: 'acc-1',
      displayName: 'Eu'
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.atlassian.net/rest/api/3/myself')
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Basic /)
  })

  it('listFields devolve o array de campos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes([{ id: 'customfield_1' }])))

    await expect(makeClient().listFields()).resolves.toEqual([{ id: 'customfield_1' }])
  })
})

describe('JiraClient.bulkChangelogs', () => {
  const history = (id: string): JiraChangelogHistory =>
    ({ id, created: '2026-07-01T00:00:00.000Z', items: [] }) as unknown as JiraChangelogHistory

  it('agrupa por issueId e concatena as páginas', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({
          issueChangeLogs: [
            { issueId: '1', changeHistories: [history('h1')] },
            { issueId: '2', changeHistories: [history('h2')] }
          ],
          nextPageToken: 'tok'
        })
      )
      .mockResolvedValueOnce(
        jsonRes({ issueChangeLogs: [{ issueId: '1', changeHistories: [history('h3')] }] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const map = await makeClient().bulkChangelogs(['BT-1', 'BT-2'])

    expect(map.get('1')?.map((h) => h.id)).toEqual(['h1', 'h3'])
    expect(map.get('2')?.map((h) => h.id)).toEqual(['h2'])
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.nextPageToken).toBe('tok')
    expect(secondBody.issueIdsOrKeys).toEqual(['BT-1', 'BT-2'])
  })

  it('entrada sem changeHistories não quebra', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ issueChangeLogs: [{ issueId: '1' }] }))
    )

    const map = await makeClient().bulkChangelogs(['BT-1'])
    expect(map.get('1')).toEqual([])
  })

  it('corpo sem issueChangeLogs devolve mapa vazio', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))

    await expect(makeClient().bulkChangelogs(['BT-1'])).resolves.toEqual(new Map())
  })

  it('mais de 500 chaves são quebradas em lotes', async () => {
    // cada chamada precisa de uma Response nova (o corpo só pode ser lido 1x)
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      void init
      return jsonRes({ issueChangeLogs: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const keys = Array.from({ length: 501 }, (_, i) => `BT-${i}`)

    await makeClient().bulkChangelogs(keys)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).issueIdsOrKeys).toHaveLength(500)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).issueIdsOrKeys).toHaveLength(1)
  })

  it('lista vazia não chama a API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().bulkChangelogs([])).resolves.toEqual(new Map())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('JiraClient.issueChangelog', () => {
  const values = (n: number, prefix = 'h'): JiraChangelogHistory[] =>
    Array.from(
      { length: n },
      (_, i) => ({ id: `${prefix}${i}` }) as unknown as JiraChangelogHistory
    )

  it('página única devolve tudo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ values: values(3), total: 3, maxResults: 100 }))
    )

    await expect(makeClient().issueChangelog('BT-1')).resolves.toHaveLength(3)
  })

  it('pagina até cobrir o total', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ values: values(100, 'a'), total: 150, maxResults: 100 }))
      .mockResolvedValueOnce(jsonRes({ values: values(50, 'b'), total: 150, maxResults: 100 }))
    vi.stubGlobal('fetch', fetchMock)

    const all = await makeClient().issueChangelog('BT-1')

    expect(all).toHaveLength(150)
    expect(urlsOf(fetchMock)[0]).toContain('startAt=0')
    expect(urlsOf(fetchMock)[1]).toContain('startAt=100')
  })

  it('changelog gigante reposiciona a paginação na janela final (300 mais recentes)', async () => {
    const fetchMock = vi
      .fn()
      // primeira chamada só descobre o total e é descartada
      .mockResolvedValueOnce(
        jsonRes({ values: values(100, 'antigo'), total: 1000, maxResults: 100 })
      )
      .mockResolvedValueOnce(jsonRes({ values: values(100, 'r1'), total: 1000, maxResults: 100 }))
      .mockResolvedValueOnce(jsonRes({ values: values(100, 'r2'), total: 1000, maxResults: 100 }))
      .mockResolvedValueOnce(jsonRes({ values: values(100, 'r3'), total: 1000, maxResults: 100 }))
    vi.stubGlobal('fetch', fetchMock)

    const all = await makeClient().issueChangelog('BT-1')

    expect(all).toHaveLength(300)
    expect(all[0].id).toBe('r10')
    expect(urlsOf(fetchMock)[1]).toContain('startAt=700')
  })

  it('maxResults 0 não trava o loop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ values: values(1), total: 50, maxResults: 0 }))
      .mockResolvedValueOnce(jsonRes({ values: values(1), total: 50, maxResults: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().issueChangelog('BT-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('key com caractere especial é escapada na URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ values: [], total: 0, maxResults: 100 }))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().issueChangelog('BT 1/2')

    expect(urlsOf(fetchMock)[0]).toContain('BT%201%2F2')
  })
})

describe('JiraClient.issueLiveFields', () => {
  it('devolve o ADF da descrição e o relator', async () => {
    const doc = { type: 'doc', version: 1, content: [] }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonRes({ fields: { description: doc, reporter: { accountId: 'a1', displayName: 'Ana' } } })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().issueLiveFields('BT-1')).resolves.toEqual({
      description: doc,
      reporter: { accountId: 'a1', displayName: 'Ana' }
    })
    expect(urlsOf(fetchMock)[0]).toContain('fields=description,reporter')
  })

  it('descrição/relator ausentes devolvem null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ fields: {} })))

    await expect(makeClient().issueLiveFields('BT-1')).resolves.toEqual({
      description: null,
      reporter: null
    })
  })

  it('corpo sem fields devolve null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})))

    await expect(makeClient().issueLiveFields('BT-1')).resolves.toEqual({
      description: null,
      reporter: null
    })
  })
})

describe('JiraClient.issueComments', () => {
  const comment = (id: string): JiraComment => ({ id }) as unknown as JiraComment

  it('pagina os comentários por startAt/maxResults', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ comments: [comment('1'), comment('2')], startAt: 0, maxResults: 2, total: 3 })
      )
      .mockResolvedValueOnce(
        jsonRes({ comments: [comment('3')], startAt: 2, maxResults: 2, total: 3 })
      )
    vi.stubGlobal('fetch', fetchMock)

    const all = await makeClient().issueComments('BT-1')

    expect(all.map((c) => c.id)).toEqual(['1', '2', '3'])
    expect(urlsOf(fetchMock)[0]).toContain('orderBy=created&startAt=0')
    expect(urlsOf(fetchMock)[1]).toContain('startAt=2')
  })

  it('sem comentários devolve lista vazia em uma chamada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ maxResults: 50, total: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().issueComments('BT-1')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('JiraClient.addAttachment', () => {
  it('envia multipart com X-Atlassian-Token e devolve o primeiro anexo criado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes([{ id: '10', filename: 'print.png' }, { id: '11' }]))
    vi.stubGlobal('fetch', fetchMock)

    const uploaded = await makeClient().addAttachment(
      'BT-1',
      'print.png',
      Buffer.from([1, 2, 3]),
      'image/png'
    )

    expect(uploaded).toEqual({ id: '10', filename: 'print.png' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/attachments')
    expect((init.headers as Record<string, string>)['X-Atlassian-Token']).toBe('no-check')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    const file = (init.body as FormData).get('file') as File
    expect(file.name).toBe('print.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBe(3)
  })

  it('sem mimeType manda o Blob sem tipo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes([{ id: '12' }]))
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().addAttachment('BT-1', 'nota.txt', Buffer.from('oi'), null)

    const file = ((fetchMock.mock.calls[0][1] as RequestInit).body as FormData).get('file') as File
    expect(file.type).toBe('')
  })

  it('resposta vazia ou não-array é erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes([])))
    await expect(
      makeClient().addAttachment('BT-1', 'a.txt', Buffer.from('x'), null)
    ).rejects.toThrow('O Jira não devolveu o anexo criado')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ id: 'não-array' })))
    await expect(
      makeClient().addAttachment('BT-1', 'a.txt', Buffer.from('x'), null)
    ).rejects.toThrow('O Jira não devolveu o anexo criado')
  })
})

describe('JiraClient.listProjects', () => {
  it('pagina enquanto isLast é false', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonRes({ values: [{ key: 'BT' }], isLast: false, maxResults: 50, startAt: 0 })
      )
      .mockResolvedValueOnce(jsonRes({ values: [{ key: 'OPS' }], isLast: true, maxResults: 50 }))
    vi.stubGlobal('fetch', fetchMock)

    const all = await makeClient().listProjects()

    expect(all.map((p) => p.key)).toEqual(['BT', 'OPS'])
    expect(urlsOf(fetchMock)[1]).toContain('startAt=50')
  })

  it('para na primeira página quando isLast é true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes({ values: [], isLast: true, maxResults: 50 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().listProjects()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('página vazia com isLast false também encerra (guarda contra loop)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes({ values: [], isLast: false, maxResults: 50 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().listProjects()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('JiraClient.listBoards', () => {
  it('pagina os boards do projeto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ values: [{ id: 1 }], isLast: false, maxResults: 50 }))
      .mockResolvedValueOnce(jsonRes({ values: [{ id: 2 }], isLast: true, maxResults: 50 }))
    vi.stubGlobal('fetch', fetchMock)

    const boards = await makeClient().listBoards('BT')

    expect(boards.map((b) => b.id)).toEqual([1, 2])
    expect(urlsOf(fetchMock)[0]).toContain('projectKeyOrId=BT')
  })

  it('projeto sem boards devolve vazio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ values: [], isLast: true, maxResults: 50 }))
    )

    await expect(makeClient().listBoards('BT')).resolves.toEqual([])
  })
})

describe('JiraClient.listSprints', () => {
  it('pagina as sprints do board', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ values: [{ id: 10 }], isLast: false, maxResults: 50 }))
      .mockResolvedValueOnce(jsonRes({ values: [{ id: 11 }], isLast: true, maxResults: 50 }))
    vi.stubGlobal('fetch', fetchMock)

    const sprints = await makeClient().listSprints(5)

    expect(sprints.map((s) => s.id)).toEqual([10, 11])
    expect(urlsOf(fetchMock)[0]).toContain(
      '/rest/agile/1.0/board/5/sprint?state=active,future,closed'
    )
  })

  it('board Kanban (400) devolve lista vazia em vez de falhar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ errorMessages: ['no sprints'] }, 400))
    )

    await expect(makeClient().listSprints(7)).resolves.toEqual([])
  })

  it('erro no meio da paginação devolve o que já foi coletado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ values: [{ id: 10 }], isLast: false, maxResults: 50 }))
      .mockResolvedValueOnce(jsonRes({ errorMessages: ['boom'] }, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeClient().listSprints(5)).resolves.toEqual([{ id: 10 }])
  })
})
