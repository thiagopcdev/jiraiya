import type { IpcChannel, IpcRequest, IpcResponse } from '@shared/ipc-contract'

export class IpcError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

/** Invoke tipado que desembrulha o envelope {ok} e lança IpcError em falha. */
export async function invoke<C extends IpcChannel>(
  channel: C,
  payload: IpcRequest<C>
): Promise<IpcResponse<C>> {
  const result = await window.api.invoke(channel, payload)
  if (!result.ok) throw new IpcError(result.code, result.message)
  return result.data
}
