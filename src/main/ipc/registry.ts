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
import { isMaybeIssueGoneError, issueKeyFromPayload } from '../issues/gone'

export class AppError extends Error {
  /**
   * `cause` guarda o erro original quando o handler troca um erro do Jira por
   * uma mensagem de negócio — é assim que o registry ainda reconhece um 404 de
   * card excluído por baixo de um 'TRANSITION_FAILED', sem perder a mensagem boa
   * nos outros casos.
   */
  constructor(
    public readonly code: string,
    message: string,
    cause?: unknown
  ) {
    super(message, { cause })
    this.name = 'AppError'
  }
}

type Handler<C extends IpcChannel> = (
  req: IpcRequest<C>
) => Promise<IpcResponse<C>> | IpcResponse<C>

/** Código devolvido quando o card não existe mais no Jira. */
export const ISSUE_GONE = 'ISSUE_GONE'

/**
 * Resolve 404 de card excluído: recebe a key e devolve a mensagem se o card
 * realmente não existe mais (já purgado do cache), ou null. Instalado uma vez no
 * boot (`makeIssueGoneResolver`) porque o registry não tem acesso ao AppContext.
 */
type IssueGoneResolver = (key: string) => Promise<string | null>
let issueGoneResolver: IssueGoneResolver | null = null

export function setIssueGoneResolver(resolver: IssueGoneResolver | null): void {
  issueGoneResolver = resolver
}

/**
 * Traduz um 404 do Jira em "card excluído" quando o canal trabalha sobre uma
 * issue. Vale para TODOS os canais de uma vez (mover, editar, comentar, abrir a
 * gaveta), por isso mora aqui e não em cada handler.
 */
async function issueGoneInfo(
  err: unknown,
  payload: unknown
): Promise<{ code: string; message: string } | null> {
  const original = err instanceof AppError ? err.cause : err
  if (!issueGoneResolver || !isMaybeIssueGoneError(original)) return null
  const key = issueKeyFromPayload(payload)
  if (!key) return null
  const message = await issueGoneResolver(key)
  return message ? { code: ISSUE_GONE, message } : null
}

/**
 * Registra um handler com validação zod do payload e envelope de erro
 * serializado — o renderer nunca vê stack traces.
 */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (_event, rawPayload: unknown): Promise<IpcResult<C>> => {
    let payload: IpcRequest<C>
    try {
      payload = ipcContract[channel].req.parse(rawPayload ?? {}) as IpcRequest<C>
    } catch (err) {
      return { ok: false, ...toErrorInfo(err) }
    }
    try {
      return { ok: true, data: await handler(payload) }
    } catch (err) {
      return { ok: false, ...((await issueGoneInfo(err, payload)) ?? toErrorInfo(err)) }
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
