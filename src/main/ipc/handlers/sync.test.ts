import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from '@shared/domain'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerSyncHandlers } = await import('./sync')

let t: ReturnType<typeof makeTestContext>

const IDLE: SyncStatus = {
  running: false,
  lastSuccessAt: null,
  lastError: null,
  progress: null
}

beforeEach(() => {
  t = makeTestContext()
  registerSyncHandlers(t.ctx)
})

describe('sync:run', () => {
  it('dispara o scheduler em background e responde started', async () => {
    const triggers: Array<{ full?: boolean }> = []
    Object.assign(t.ctx, {
      scheduler: {
        trigger: async (opts: { full?: boolean }) => {
          triggers.push(opts)
          return true
        }
      }
    })

    const res = await invokeHandler('sync:run', { full: true })
    expect(res.ok && res.data).toEqual({ started: true })
    expect(triggers).toEqual([{ full: true }])
  })

  it('sem scheduler ainda responde started', async () => {
    Object.assign(t.ctx, { scheduler: null })
    const res = await invokeHandler('sync:run', {})
    expect(res.ok && res.data).toEqual({ started: true })
  })

  it('full não booleano → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('sync:run', { full: 'sim' } as unknown as { full?: boolean })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('sync:status', () => {
  it('devolve o status do scheduler', async () => {
    const status: SyncStatus = {
      running: true,
      lastSuccessAt: '2026-07-20T10:00:00.000Z',
      lastError: null,
      progress: null
    }
    Object.assign(t.ctx, { scheduler: { status: () => status } })

    const res = await invokeHandler('sync:status', {})
    expect(res.ok && res.data).toEqual(status)
  })

  it('sem scheduler → status parado', async () => {
    Object.assign(t.ctx, { scheduler: null })
    const res = await invokeHandler('sync:status', {})
    expect(res.ok && res.data).toEqual(IDLE)
  })
})
