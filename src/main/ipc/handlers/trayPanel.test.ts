import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerTrayPanelHandlers } = await import('./trayPanel')

let t: ReturnType<typeof makeTestContext>
let shown: number

beforeEach(() => {
  shown = 0
  t = makeTestContext()
  registerTrayPanelHandlers(t.ctx, {
    showWindow: () => {
      shown++
    }
  })
})

describe('app:focusIssue', () => {
  it('mostra a janela e faz push do card para a gaveta', async () => {
    const res = await invokeHandler('app:focusIssue', { key: 'BT-42' })
    expect(res.ok && res.data).toEqual({ ok: true })
    expect(shown).toBe(1)
    expect(t.pushes).toEqual([{ channel: 'push:open-issue', payload: { key: 'BT-42' } }])
  })

  it('key vazia → INVALID_PAYLOAD e nada acontece', async () => {
    const res = await invokeHandler('app:focusIssue', { key: '   ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
    expect(shown).toBe(0)
    expect(t.pushes).toEqual([])
  })
})

describe('app:show', () => {
  it('só mostra a janela', async () => {
    const res = await invokeHandler('app:show', {})
    expect(res.ok && res.data).toEqual({ ok: true })
    expect(shown).toBe(1)
    expect(t.pushes).toEqual([])
  })
})
