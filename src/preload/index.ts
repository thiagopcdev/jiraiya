import { contextBridge, ipcRenderer } from 'electron'
import type {
  IpcChannel,
  IpcRequest,
  IpcResult,
  PushChannel,
  PushEvents,
  RendererApi
} from '@shared/ipc-contract'

const ALLOWED_PUSH: readonly string[] = [
  'push:sync-progress',
  'push:sync-complete',
  'push:alerts-updated',
  'push:mentions-updated',
  'push:auth-invalid',
  'push:update-available',
  'push:briefing-ready',
  'push:open-issue'
]

const api: RendererApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResult<C>> {
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<C>>
  },
  on<P extends PushChannel>(channel: P, cb: (payload: PushEvents[P]) => void): () => void {
    if (!ALLOWED_PUSH.includes(channel)) {
      throw new Error(`Canal push desconhecido: ${channel}`)
    }
    const listener = (_event: Electron.IpcRendererEvent, payload: PushEvents[P]): void =>
      cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
