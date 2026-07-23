import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraClient } from './client'
import { JiraHttp } from './http'

const jsonRes = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

const noContentRes = (): Response => new Response(null, { status: 204 })

const bytesRes = (bytes: Uint8Array, mimeType: string | null): Response =>
  // Uint8Array não é BodyInit no lib do TS deste projeto — passa o ArrayBuffer subjacente
  new Response(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    {
      status: 200,
      headers: mimeType ? { 'Content-Type': mimeType } : {}
    }
  )

const makeClient = (): JiraClient =>
  new JiraClient(
    new JiraHttp({ siteUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' })
  )

afterEach(() => vi.unstubAllGlobals())

describe('JiraClient.issueAttachments', () => {
  it('GET /rest/api/3/issue/BT-1?fields=attachment mapeia id/filename/mimeType/size', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonRes({
        fields: {
          attachment: [
            { id: '11819', filename: 'x.pdf', mimeType: 'application/pdf', size: 166333 }
          ]
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().issueAttachments('BT-1')

    expect(result).toEqual([
      { id: '11819', filename: 'x.pdf', mimeType: 'application/pdf', size: 166333 }
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1?fields=attachment')
    expect((init as RequestInit).method).toBe('GET')
  })

  it('sem attachment → []', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonRes({ fields: {} }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().issueAttachments('BT-1')

    expect(result).toEqual([])
  })
})

describe('JiraClient.attachmentThumbnail', () => {
  it('GET /rest/api/3/attachment/thumbnail/11819?redirect=true e repassa {data, mimeType}', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchMock = vi.fn().mockResolvedValueOnce(bytesRes(bytes, 'image/png'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().attachmentThumbnail('11819')

    expect(result.mimeType).toBe('image/png')
    expect(Buffer.from(result.data)).toEqual(Buffer.from(bytes))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe(
      'https://x.atlassian.net/rest/api/3/attachment/thumbnail/11819?redirect=true'
    )
    expect((init as RequestInit).method).toBe('GET')
  })
})

describe('JiraClient.attachmentContent', () => {
  it('GET /rest/api/3/attachment/content/11819?redirect=true e repassa {data, mimeType}', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const fetchMock = vi.fn().mockResolvedValueOnce(bytesRes(bytes, 'application/pdf'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeClient().attachmentContent('11819')

    expect(result.mimeType).toBe('application/pdf')
    expect(Buffer.from(result.data)).toEqual(Buffer.from(bytes))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe(
      'https://x.atlassian.net/rest/api/3/attachment/content/11819?redirect=true'
    )
    expect((init as RequestInit).method).toBe('GET')
  })
})

describe('JiraClient.updateComment', () => {
  it('PUT /rest/api/3/issue/BT-1/comment/12916 com body {body: <adf>}', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    const adf = { type: 'doc', version: 1, content: [] }
    await makeClient().updateComment('BT-1', '12916', adf)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/comment/12916')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ body: adf })
  })
})

describe('JiraClient.deleteComment', () => {
  it('DELETE /rest/api/3/issue/BT-1/comment/12916', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(noContentRes())
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().deleteComment('BT-1', '12916')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url as string).toBe('https://x.atlassian.net/rest/api/3/issue/BT-1/comment/12916')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})
