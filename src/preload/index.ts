import { contextBridge, ipcRenderer } from 'electron'
import { PUSH_CHANNELS } from '@shared/ipc-contract'
import type {
  IpcChannel,
  IpcRequest,
  IpcResult,
  PushChannel,
  PushEvents,
  RendererApi
} from '@shared/ipc-contract'

// Fonte única: a allowlist vem do contrato. Manter uma cópia manual aqui já
// causou tela preta (canal novo no contrato, espelho esquecido → throw no boot).
const ALLOWED_PUSH: readonly string[] = PUSH_CHANNELS

const api: RendererApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResult<C>> {
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResult<C>>
  },
  on<P extends PushChannel>(channel: P, cb: (payload: PushEvents[P]) => void): () => void {
    if (!ALLOWED_PUSH.includes(channel)) {
      // não lança: um canal fora da lista não pode derrubar a montagem do app
      console.error(`Canal push desconhecido ignorado: ${channel}`)
      return () => {}
    }
    const listener = (_event: Electron.IpcRendererEvent, payload: PushEvents[P]): void =>
      cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
