import { JiraAuthError, JiraHttpError } from '../jira/http'

/**
 * Códigos de erro de rede/socket que indicam "sem conexão" — vale enfileirar e
 * tentar de novo depois. O `fetch` do Node (undici) embrulha o erro original em
 * `cause`, por isso a busca desce alguns níveis.
 */
const RETRYABLE_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])

const MAX_CAUSE_DEPTH = 3

/** Procura um `code` retryable no erro e recursivamente em `cause`. */
function hasRetryableCode(err: unknown, depth: number): boolean {
  if (depth > MAX_CAUSE_DEPTH || typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; cause?: unknown }
  if (typeof candidate.code === 'string' && RETRYABLE_CODES.has(candidate.code)) return true
  return hasRetryableCode(candidate.cause, depth + 1)
}

/**
 * True quando o erro parece falta de conexão (ou indisponibilidade temporária do
 * Jira) — nesse caso a ação vai para a fila offline. Erros de negócio, validação
 * ou credencial retornam false e sobem para o renderer como sempre.
 */
export function isRetryableNetworkError(err: unknown): boolean {
  // JiraAuthError é subclasse de JiraHttpError: precisa ser testado primeiro
  if (err instanceof JiraAuthError) return false
  if (err instanceof JiraHttpError) return err.status === 429 || err.status >= 500

  if (hasRetryableCode(err, 0)) return true

  if (typeof err === 'object' && err !== null) {
    const { name, message } = err as { name?: unknown; message?: unknown }
    // fetch do Node lança TypeError('fetch failed') quando o DNS/socket falha
    if (
      (err instanceof TypeError || name === 'TypeError') &&
      typeof message === 'string' &&
      message.includes('fetch failed')
    ) {
      return true
    }
    if (name === 'AbortError' || name === 'TimeoutError') return true
  }

  return false
}
