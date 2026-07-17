import { afterEach, describe, expect, it, vi } from 'vitest'
import { JiraAuthError, JiraHttp } from './http'

function makeHttp(onAuthError?: () => void): JiraHttp {
  return new JiraHttp({
    siteUrl: 'https://x.atlassian.net',
    email: 'a@b.c',
    apiToken: 't',
    maxRetries: 3,
    onAuthError
  })
}

const jsonRes = (status: number, body: unknown, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('JiraHttp', () => {
  it('retorna JSON em 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, { ok: 1 })))
    const res = await makeHttp().get<{ ok: number }>('/rest/api/3/myself')
    expect(res.ok).toBe(1)
  })

  it('429 respeita Retry-After e depois sucede', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonRes(200, { ok: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await makeHttp().get<{ ok: number }>('/x')
    expect(res.ok).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('401 dispara onAuthError e lança JiraAuthError sem retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(401, {}))
    const onAuthError = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(makeHttp(onAuthError).get('/x')).rejects.toBeInstanceOf(JiraAuthError)
    expect(onAuthError).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('envia Basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await makeHttp().get('/x')
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('a@b.c:t').toString('base64'))
  })
})
