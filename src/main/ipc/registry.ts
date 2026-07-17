import { ipcMain } from 'electron'
import { ZodError } from 'zod'
import {
  ipcContract,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult
} from '@shared/ipc-contract'
import { JiraAuthError, JiraHttpError } from '../jira/http'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

type Handler<C extends IpcChannel> = (req: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>

/**
 * Registra um handler com validação zod do payload e envelope de erro
 * serializado — o renderer nunca vê stack traces.
 */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (_event, rawPayload: unknown): Promise<IpcResult<C>> => {
    try {
      const payload = ipcContract[channel].req.parse(rawPayload ?? {}) as IpcRequest<C>
      const data = await handler(payload)
      return { ok: true, data }
    } catch (err) {
      return { ok: false, ...toErrorInfo(err) }
    }
  })
}

function toErrorInfo(err: unknown): { code: string; message: string } {
  if (err instanceof ZodError) {
    return { code: 'INVALID_PAYLOAD', message: 'Requisição inválida' }
  }
  if (err instanceof JiraAuthError) {
    return { code: 'JIRA_AUTH', message: err.message }
  }
  if (err instanceof JiraHttpError) {
    return { code: 'JIRA_HTTP', message: err.message }
  }
  if (err instanceof AppError) {
    return { code: err.code, message: err.message }
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message }
  }
  return { code: 'INTERNAL', message: 'Erro inesperado' }
}
