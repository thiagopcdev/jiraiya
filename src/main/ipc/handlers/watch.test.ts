import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerWatchHandlers } = await import('./watch')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerWatchHandlers(t.ctx)
})

describe('watch:toggle', () => {
  it('primeiro toggle liga, segundo desliga', async () => {
    const on = await invokeHandler('watch:toggle', { key: 'BT-1' })
    expect(on.ok && on.data).toEqual({ watching: true })

    const off = await invokeHandler('watch:toggle', { key: 'BT-1' })
    expect(off.ok && off.data).toEqual({ watching: false })
  })

  it('normaliza a key (bt-1 e BT-1 são o mesmo card)', async () => {
    await invokeHandler('watch:toggle', { key: ' bt-1 ' })
    const status = await invokeHandler('watch:status', { key: 'BT-1' })
    expect(status.ok && status.data).toEqual({ watching: true })
  })

  it('key vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('watch:toggle', { key: '  ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('watch:status', () => {
  it('card não seguido → watching false', async () => {
    const res = await invokeHandler('watch:status', { key: 'BT-99' })
    expect(res.ok && res.data).toEqual({ watching: false })
  })
})

describe('watch:list', () => {
  it('lista só os seguidos que existem no cache local', async () => {
    seedIssue(t.db, 'BT-1')
    await invokeHandler('watch:toggle', { key: 'BT-1' })
    // seguido sem sync local: precisa ser omitido da lista
    await invokeHandler('watch:toggle', { key: 'BT-404' })

    const res = await invokeHandler('watch:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.issues.map((i) => i.key)).toEqual(['BT-1'])
    expect(res.data.issues[0].url).toBe('https://x.atlassian.net/browse/BT-1')
  })

  it('sem nada seguido → lista vazia', async () => {
    const res = await invokeHandler('watch:list', {})
    expect(res.ok && res.data.issues).toEqual([])
  })
})

describe('sem workspace conectado', () => {
  beforeEach(() => {
    t.db.prepare('DELETE FROM workspace').run()
  })

  it('watch:toggle → NOT_CONNECTED', async () => {
    const res = await invokeHandler('watch:toggle', { key: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('watch:status → NOT_CONNECTED', async () => {
    const res = await invokeHandler('watch:status', { key: 'BT-1' })
    expect(res.ok).toBe(false)
  })

  it('watch:list → NOT_CONNECTED', async () => {
    const res = await invokeHandler('watch:list', {})
    expect(res.ok).toBe(false)
  })
})
