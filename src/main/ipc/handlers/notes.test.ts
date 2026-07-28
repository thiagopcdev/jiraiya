import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerNotesHandlers } = await import('./notes')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerNotesHandlers(t.ctx)
})

describe('notes:get', () => {
  it('card sem nota → content e updatedAt null', async () => {
    const res = await invokeHandler('notes:get', { key: 'BT-1' })
    expect(res.ok && res.data).toEqual({ content: null, updatedAt: null })
  })

  it('key é normalizada para maiúsculas (lê o que foi gravado em minúsculas)', async () => {
    await invokeHandler('notes:set', { key: 'BT-7', content: 'minha nota' })
    const res = await invokeHandler('notes:get', { key: ' bt-7 ' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.content).toBe('minha nota')
    expect(res.data.updatedAt).not.toBeNull()
  })
})

describe('notes:set', () => {
  it('grava a nota e responde ok', async () => {
    const res = await invokeHandler('notes:set', { key: 'BT-2', content: 'contexto' })
    expect(res.ok && res.data).toEqual({ ok: true })
  })

  it('conteúdo vazio apaga a nota', async () => {
    await invokeHandler('notes:set', { key: 'BT-3', content: 'temp' })
    await invokeHandler('notes:set', { key: 'BT-3', content: '' })
    const res = await invokeHandler('notes:get', { key: 'BT-3' })
    expect(res.ok && res.data.content).toBeNull()
  })

  it('key vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('notes:set', { key: '   ', content: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('sem workspace conectado', () => {
  beforeEach(() => {
    t.db.prepare('DELETE FROM workspace').run()
  })

  it('notes:get → NOT_CONNECTED', async () => {
    const res = await invokeHandler('notes:get', { key: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('notes:set → NOT_CONNECTED', async () => {
    const res = await invokeHandler('notes:set', { key: 'BT-1', content: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
