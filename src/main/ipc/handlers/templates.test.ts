import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerTemplateHandlers } = await import('./templates')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerTemplateHandlers(t.ctx)
})

describe('templates:list', () => {
  it('workspace novo → lista vazia', async () => {
    const res = await invokeHandler('templates:list', {})
    expect(res.ok && res.data.templates).toEqual([])
  })
})

describe('templates:save', () => {
  it('sem id cria e aparece no list', async () => {
    const res = await invokeHandler('templates:save', { name: 'PR aberto', content: 'PR: {url}' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.template.name).toBe('PR aberto')

    const list = await invokeHandler('templates:list', {})
    expect(list.ok && list.data.templates).toEqual([
      { id: res.data.template.id, name: 'PR aberto', content: 'PR: {url}' }
    ])
  })

  it('com id existente edita no lugar', async () => {
    const created = await invokeHandler('templates:save', { name: 'A', content: 'a' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const edited = await invokeHandler('templates:save', {
      id: created.data.template.id,
      name: 'B',
      content: 'b'
    })
    expect(edited.ok && edited.data.template).toEqual({
      id: created.data.template.id,
      name: 'B',
      content: 'b'
    })
  })

  it('id inexistente → TEMPLATE_NOT_FOUND', async () => {
    const res = await invokeHandler('templates:save', { id: 999, name: 'X', content: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('TEMPLATE_NOT_FOUND')
    expect(res.message).toBe('Template não encontrado')
  })

  it('nome vazio → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('templates:save', { name: '   ', content: 'x' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('templates:delete', () => {
  it('remove o template', async () => {
    const created = await invokeHandler('templates:save', { name: 'A', content: 'a' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const res = await invokeHandler('templates:delete', { id: created.data.template.id })
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('templates:list', {})
    expect(list.ok && list.data.templates).toEqual([])
  })

  it('id inexistente é silencioso', async () => {
    const res = await invokeHandler('templates:delete', { id: 4242 })
    expect(res.ok && res.data).toEqual({ ok: true })
  })
})

describe('sem workspace conectado', () => {
  beforeEach(() => {
    t.db.prepare('DELETE FROM workspace').run()
  })

  it('templates:list → NOT_CONNECTED', async () => {
    const res = await invokeHandler('templates:list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('templates:save → NOT_CONNECTED', async () => {
    const res = await invokeHandler('templates:save', { name: 'A', content: 'a' })
    expect(res.ok).toBe(false)
  })

  it('templates:delete → NOT_CONNECTED', async () => {
    const res = await invokeHandler('templates:delete', { id: 1 })
    expect(res.ok).toBe(false)
  })
})
