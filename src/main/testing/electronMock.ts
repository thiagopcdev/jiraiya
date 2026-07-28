/* eslint-disable @typescript-eslint/no-empty-function -- stubs do electron são vazios por natureza */
import { tmpdir } from 'os'
import type { IpcChannel, IpcRequest, IpcResult } from '@shared/ipc-contract'

/**
 * Mock do módulo `electron` para testar handlers IPC e módulos do main
 * fora do runtime do Electron. Uso nos testes:
 *
 *   vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())
 *
 * O `handle()` do registry registra no ipcMain mockado; invoque via `invokeHandler`.
 */

type IpcWrapper = (event: unknown, payload: unknown) => Promise<unknown>

export const ipcHandlers = new Map<string, IpcWrapper>()
export const shownNotifications: Array<{ title?: string; body?: string }> = []
export const clipboardWrites: string[] = []
export const openedExternal: string[] = []

export function resetElectronMock(): void {
  shownNotifications.length = 0
  clipboardWrites.length = 0
  openedExternal.length = 0
}

/** Invoca um handler registrado, com o mesmo envelope/validação zod da produção. */
export async function invokeHandler<C extends IpcChannel>(
  channel: C,
  payload: IpcRequest<C>
): Promise<IpcResult<C>> {
  const wrapper = ipcHandlers.get(channel)
  if (!wrapper) throw new Error(`handler não registrado: ${channel}`)
  return (await wrapper(null, payload)) as IpcResult<C>
}

export function createElectronMock(): Record<string, unknown> {
  return {
    ipcMain: {
      handle: (channel: string, fn: IpcWrapper) => ipcHandlers.set(channel, fn),
      removeHandler: (channel: string) => ipcHandlers.delete(channel)
    },
    app: {
      getPath: () => tmpdir(),
      getVersion: () => '0.0.0-test',
      getName: () => 'Jiraiya',
      isPackaged: false
    },
    Notification: class {
      constructor(opts: { title?: string; body?: string }) {
        shownNotifications.push(opts)
      }
      show(): void {}
      on(): void {}
      static isSupported(): boolean {
        return true
      }
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
    },
    clipboard: { writeText: (s: string) => clipboardWrites.push(s) },
    dialog: { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
    shell: {
      openExternal: async (url: string) => {
        openedExternal.push(url)
      },
      openPath: async () => ''
    },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: true, on: () => {} },
    BrowserWindow: class {},
    net: { isOnline: () => true }
  }
}
