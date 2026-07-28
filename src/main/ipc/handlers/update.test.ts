import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())
vi.mock('../../update', () => ({
  checkForUpdate: vi.fn(),
  downloadUpdate: vi.fn()
}))

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { getCredential } = await import('../../security/credentials')
const { checkForUpdate, downloadUpdate } = await import('../../update')
const { registerUpdateHandlers } = await import('./update')

let t: ReturnType<typeof makeTestContext>

const STATUS = {
  current: '2.0.0',
  latest: '2.1.0',
  url: 'https://github.com/x/releases/tag/v2.1.0',
  available: true,
  tokenConfigured: true,
  error: null
}

beforeEach(() => {
  vi.mocked(checkForUpdate).mockReset()
  vi.mocked(downloadUpdate).mockReset()
  t = makeTestContext()
  registerUpdateHandlers(t.ctx)
})

describe('update:check', () => {
  it('devolve o status e repassa o push de versão disponível', async () => {
    vi.mocked(checkForUpdate).mockImplementation(async (_db, opts) => {
      opts.push({ version: '2.1.0', url: STATUS.url })
      return STATUS
    })

    const res = await invokeHandler('update:check', {})
    expect(res.ok && res.data).toEqual(STATUS)
    expect(t.pushes).toEqual([
      { channel: 'push:update-available', payload: { version: '2.1.0', url: STATUS.url } }
    ])
    expect(vi.mocked(checkForUpdate).mock.calls[0][1].notify).toBe(false)
  })

  it('erro de rede vira status com error (o módulo não lança)', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue({
      ...STATUS,
      latest: null,
      url: null,
      available: false,
      error: 'offline'
    })

    const res = await invokeHandler('update:check', {})
    expect(res.ok && res.data.error).toBe('offline')
    expect(t.pushes).toEqual([])
  })
})

describe('update:download', () => {
  it('baixa, repassa o progresso e devolve o path do instalador', async () => {
    vi.mocked(downloadUpdate).mockImplementation(async (_db, onProgress) => {
      onProgress(42)
      return '/tmp/jiraiya-update/Jiraiya.dmg'
    })

    const res = await invokeHandler('update:download', {})
    expect(res.ok && res.data).toEqual({ ok: true, path: '/tmp/jiraiya-update/Jiraiya.dmg' })
    expect(t.pushes).toEqual([{ channel: 'push:update-progress', payload: { percent: 42 } }])
  })

  it('falha no download → UPDATE_DOWNLOAD com a mensagem do erro', async () => {
    vi.mocked(downloadUpdate).mockRejectedValue(new Error('HTTP 403'))

    const res = await invokeHandler('update:download', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('UPDATE_DOWNLOAD')
    expect(res.message).toBe('HTTP 403')
  })

  it('rejeição não-Error → mensagem genérica', async () => {
    vi.mocked(downloadUpdate).mockRejectedValue('boom')

    const res = await invokeHandler('update:download', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toBe('Falha ao baixar a atualização')
  })
})

describe('update:setToken', () => {
  it('token grava a credencial do GitHub sem tocar no token do Jira', async () => {
    const res = await invokeHandler('update:setToken', { token: 'ghp_abc' })
    expect(res.ok && res.data).toEqual({ ok: true })
    expect(getCredential(t.db, 1, 'github_token')).toBe('ghp_abc')
  })

  it('gravar de novo substitui a anterior (não acumula)', async () => {
    await invokeHandler('update:setToken', { token: 'ghp_1' })
    await invokeHandler('update:setToken', { token: 'ghp_2' })
    expect(getCredential(t.db, 1, 'github_token')).toBe('ghp_2')
    const row = t.db
      .prepare(`SELECT COUNT(*) AS n FROM integration_credential WHERE type = 'github_token'`)
      .get() as { n: number }
    expect(row.n).toBe(1)
  })

  it('token null apaga a credencial', async () => {
    await invokeHandler('update:setToken', { token: 'ghp_abc' })
    const res = await invokeHandler('update:setToken', { token: null })
    expect(res.ok).toBe(true)
    expect(getCredential(t.db, 1, 'github_token')).toBeNull()
  })

  it('token vazio → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('update:setToken', { token: '   ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('update:setToken', { token: 'ghp_abc' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
