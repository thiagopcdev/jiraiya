import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { JiraClient } from '../jira/client'
import { runMigrations } from '../db/migrations'
import { setPrefs, setSyncState } from '../db/repos/misc'
import type { SyncProgress } from './engine'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

const runSyncMock = vi.hoisted(() => vi.fn())
vi.mock('./engine', () => ({ runSync: runSyncMock }))

const { SyncScheduler } = await import('./scheduler')

let db: Database.Database
let progress: SyncProgress[]
let completed: Array<{ success: boolean; error: string | null }>

const CLIENT = {} as unknown as JiraClient

/** Promise controlada pelo teste (para segurar um sync no meio). */
function deferred(): {
  promise: Promise<{ issuesProcessed: number; activitiesIssues: number }>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<{ issuesProcessed: number; activitiesIssues: number }>((r) => {
    resolve = () => r({ issuesProcessed: 0, activitiesIssues: 0 })
  })
  return { promise, resolve }
}

function insertWorkspace(): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
  ).run()
}

function makeScheduler(
  over: Partial<ConstructorParameters<typeof SyncScheduler>[0]> = {}
): InstanceType<typeof SyncScheduler> {
  return new SyncScheduler({
    db,
    getClient: () => CLIENT,
    onProgress: (p) => progress.push(p),
    onComplete: (r) => completed.push(r),
    ...over
  })
}

beforeEach(() => {
  runSyncMock.mockReset()
  runSyncMock.mockResolvedValue({ issuesProcessed: 0, activitiesIssues: 0 })
  progress = []
  completed = []
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('trigger — guardas', () => {
  it('sem workspace não roda o sync', async () => {
    const scheduler = makeScheduler()

    await expect(scheduler.trigger()).resolves.toBe(false)
    expect(runSyncMock).not.toHaveBeenCalled()
    expect(completed).toEqual([])
  })

  it('desconectado (getClient null) não roda o sync', async () => {
    insertWorkspace()
    const scheduler = makeScheduler({ getClient: () => null })

    await expect(scheduler.trigger()).resolves.toBe(false)
    expect(runSyncMock).not.toHaveBeenCalled()
  })

  it('trigger reentrante devolve false enquanto o primeiro não termina', async () => {
    insertWorkspace()
    const emAndamento = deferred()
    runSyncMock.mockImplementation(() => emAndamento.promise)
    const scheduler = makeScheduler()

    const first = scheduler.trigger()
    await vi.waitFor(() => expect(runSyncMock).toHaveBeenCalled())
    expect(scheduler.status().running).toBe(true)

    await expect(scheduler.trigger()).resolves.toBe(false)
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    emAndamento.resolve()
    await expect(first).resolves.toBe(true)
    expect(scheduler.status().running).toBe(false)
  })
})

describe('trigger — execução', () => {
  beforeEach(() => {
    insertWorkspace()
  })

  it('passa db, client e workspace para o engine e repassa opts', async () => {
    const scheduler = makeScheduler()

    await scheduler.trigger({ full: true })

    const [deps, opts] = runSyncMock.mock.calls[0]
    expect(deps.db).toBe(db)
    expect(deps.client).toBe(CLIENT)
    expect(deps.workspace.id).toBe(1)
    expect(opts).toEqual({ full: true })
  })

  it('onBeforeSync é aguardado ANTES do engine (drena a fila offline primeiro)', async () => {
    const order: string[] = []
    runSyncMock.mockImplementation(async () => {
      order.push('runSync')
      return { issuesProcessed: 0, activitiesIssues: 0 }
    })
    const scheduler = makeScheduler({
      onBeforeSync: async () => {
        await Promise.resolve()
        order.push('beforeSync')
      }
    })

    await scheduler.trigger()

    expect(order).toEqual(['beforeSync', 'runSync'])
  })

  it('erro no onBeforeSync é logado e o sync segue', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scheduler = makeScheduler({
      onBeforeSync: async () => {
        throw new Error('fila travada')
      }
    })

    await expect(scheduler.trigger()).resolves.toBe(true)
    expect(runSyncMock).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith('[sync] onBeforeSync falhou', expect.any(Error))
  })

  it('repassa onAfterSync e o progresso para os callbacks do dono', async () => {
    const onAfterSync = vi.fn()
    runSyncMock.mockImplementation(
      async (deps: { onProgress?: (p: SyncProgress) => void; onAfterSync?: unknown }) => {
        deps.onProgress?.({ phase: 'issues', done: 2, total: null })
        return { issuesProcessed: 2, activitiesIssues: 0 }
      }
    )
    const scheduler = makeScheduler({ onAfterSync })

    await scheduler.trigger()

    expect(progress).toEqual([{ phase: 'issues', done: 2, total: null }])
    expect(runSyncMock.mock.calls[0][0].onAfterSync).toBe(onAfterSync)
  })

  it('sucesso avisa onComplete e limpa o último erro', async () => {
    const scheduler = makeScheduler()
    runSyncMock.mockRejectedValueOnce(new Error('falha temporária'))
    await scheduler.trigger()
    expect(scheduler.status().lastError).toBe('falha temporária')

    await expect(scheduler.trigger()).resolves.toBe(true)

    expect(completed).toEqual([
      { success: false, error: 'falha temporária' },
      { success: true, error: null }
    ])
    expect(scheduler.status().lastError).toBeNull()
  })

  it('falha devolve false, guarda a mensagem e avisa onComplete', async () => {
    runSyncMock.mockRejectedValue(new Error('Jira fora do ar'))
    const scheduler = makeScheduler()

    await expect(scheduler.trigger()).resolves.toBe(false)

    expect(completed).toEqual([{ success: false, error: 'Jira fora do ar' }])
    expect(scheduler.status().lastError).toBe('Jira fora do ar')
    expect(scheduler.status().running).toBe(false)
  })

  it('rejeição não-Error é convertida em string', async () => {
    runSyncMock.mockRejectedValue('pane geral')
    const scheduler = makeScheduler()

    await scheduler.trigger()

    expect(scheduler.status().lastError).toBe('pane geral')
  })
})

describe('status', () => {
  it('sem workspace: parado, sem último sucesso', () => {
    expect(makeScheduler().status()).toEqual({
      running: false,
      lastSuccessAt: null,
      lastError: null,
      progress: null
    })
  })

  it('traz o last_success_at do sync_state', () => {
    insertWorkspace()
    setSyncState(db, 1, 'issues', { status: 'idle', success: true })

    expect(makeScheduler().status().lastSuccessAt).not.toBeNull()
  })

  it('progresso só aparece enquanto está rodando', async () => {
    insertWorkspace()
    const emAndamento = deferred()
    runSyncMock.mockImplementation((deps: { onProgress?: (p: SyncProgress) => void }) => {
      deps.onProgress?.({ phase: 'activities', done: 3, total: 10 })
      return emAndamento.promise
    })
    const scheduler = makeScheduler()

    const running = scheduler.trigger()
    await vi.waitFor(() => expect(runSyncMock).toHaveBeenCalled())
    expect(scheduler.status().progress).toEqual({ phase: 'activities', done: 3, total: 10 })

    emAndamento.resolve()
    await running
    expect(scheduler.status().progress).toBeNull()
  })
})

describe('start / reschedule / stop', () => {
  it('start agenda o sync inicial com atraso de 3s e o periódico pelo pref', async () => {
    vi.useFakeTimers()
    insertWorkspace()
    setPrefs(db, { syncIntervalMinutes: 1 })
    const scheduler = makeScheduler()

    scheduler.start()
    expect(runSyncMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runSyncMock).toHaveBeenCalledTimes(2)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(runSyncMock).toHaveBeenCalledTimes(2)
  })

  it('reschedule troca o intervalo sem acumular timers', async () => {
    vi.useFakeTimers()
    insertWorkspace()
    setPrefs(db, { syncIntervalMinutes: 10 })
    const scheduler = makeScheduler()

    scheduler.reschedule()
    setPrefs(db, { syncIntervalMinutes: 1 })
    scheduler.reschedule()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(runSyncMock).toHaveBeenCalledTimes(1)

    scheduler.stop()
  })

  it('stop é idempotente mesmo sem timer ativo', () => {
    const scheduler = makeScheduler()
    expect(() => {
      scheduler.stop()
      scheduler.stop()
    }).not.toThrow()
  })
})
