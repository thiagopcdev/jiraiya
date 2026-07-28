import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { reconcileAlerts } = await import('../../db/repos/misc')
const { registerAlertHandlers } = await import('./alerts')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerAlertHandlers(t.ctx)
})

describe('alerts:list', () => {
  it('sem alertas → lista vazia', async () => {
    const res = await invokeHandler('alerts:list', {})
    expect(res.ok && res.data.alerts).toEqual([])
  })

  it('lista os alertas ativos, críticos primeiro', async () => {
    reconcileAlerts(t.db, 1, [
      { ruleId: 'stalled', issueKey: 'BT-2', severity: 'warning', message: 'Parado' },
      { ruleId: 'blocked', issueKey: 'BT-1', severity: 'critical', message: 'Bloqueado' }
    ])

    const res = await invokeHandler('alerts:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.alerts.map((a) => a.severity)).toEqual(['critical', 'warning'])
  })

  it('sem workspace → lista vazia em vez de erro', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('alerts:list', {})
    expect(res.ok && res.data.alerts).toEqual([])
  })
})

describe('alerts:dismiss', () => {
  it('alerta dispensado sai do list', async () => {
    reconcileAlerts(t.db, 1, [
      { ruleId: 'stalled', issueKey: 'BT-2', severity: 'warning', message: 'Parado' }
    ])
    const before = await invokeHandler('alerts:list', {})
    expect(before.ok).toBe(true)
    if (!before.ok) return

    const res = await invokeHandler('alerts:dismiss', { id: before.data.alerts[0].id })
    expect(res.ok && res.data).toEqual({ ok: true })

    const after = await invokeHandler('alerts:list', {})
    expect(after.ok && after.data.alerts).toEqual([])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('alerts:dismiss', { id: 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('id não numérico → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('alerts:dismiss', { id: 'x' } as unknown as { id: number })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
