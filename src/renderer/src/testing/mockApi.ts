import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult,
  PushChannel,
  PushEvents
} from '@shared/ipc-contract'

/**
 * Mock do `window.api` (preload) para testes de componente.
 * Instale ANTES do render; canais sem handler resolvem com erro NO_MOCK
 * (o invoke do api/client lança IpcError — o componente exibe o estado de erro).
 */

export type MockHandlers = {
  [C in IpcChannel]?: (payload: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
}

/** Lança dentro de um handler para simular erro de negócio do main. */
export class MockIpcFailure extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MockIpcFailure'
  }
}

export interface MockApiControl {
  /** todas as chamadas invoke, na ordem */
  calls: Array<{ channel: IpcChannel; payload: unknown }>
  /** registra/substitui o handler de um canal */
  set<C extends IpcChannel>(
    channel: C,
    fn: (payload: IpcRequest<C>) => IpcResponse<C> | Promise<IpcResponse<C>>
  ): void
  /** emite um push como se viesse do main */
  push<P extends PushChannel>(channel: P, payload: PushEvents[P]): void
  /** quantas chamadas um canal recebeu */
  count(channel: IpcChannel): number
  /** payload da última chamada de um canal (undefined se nunca chamado) */
  lastPayload<C extends IpcChannel>(channel: C): IpcRequest<C> | undefined
}

export function installMockApi(handlers: MockHandlers = {}): MockApiControl {
  const table = new Map<string, (payload: unknown) => unknown>(
    Object.entries(handlers) as Array<[string, (payload: unknown) => unknown]>
  )
  const calls: MockApiControl['calls'] = []
  const listeners = new Map<string, Set<(payload: unknown) => void>>()

  const api = {
    async invoke(channel: IpcChannel, payload: unknown): Promise<IpcResult<IpcChannel>> {
      calls.push({ channel, payload })
      const fn = table.get(channel)
      if (!fn) {
        return { ok: false, code: 'NO_MOCK', message: `canal não mockado: ${channel}` }
      }
      try {
        const data = (await fn(payload)) as never
        return { ok: true, data }
      } catch (err) {
        if (err instanceof MockIpcFailure)
          return { ok: false, code: err.code, message: err.message }
        return {
          ok: false,
          code: 'MOCK_ERROR',
          message: err instanceof Error ? err.message : 'erro'
        }
      }
    },
    on(channel: string, cb: (payload: unknown) => void): () => void {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(cb)
      return () => listeners.get(channel)?.delete(cb)
    }
  }

  ;(window as unknown as { api: typeof api }).api = api

  return {
    calls,
    set(channel, fn) {
      table.set(channel, fn as (payload: unknown) => unknown)
    },
    push(channel, payload) {
      listeners.get(channel)?.forEach((cb) => cb(payload))
    },
    count(channel) {
      return calls.filter((c) => c.channel === channel).length
    },
    lastPayload(channel) {
      const hit = [...calls].reverse().find((c) => c.channel === channel)
      return hit?.payload as never
    }
  }
}
