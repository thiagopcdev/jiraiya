import type { AiFeature } from '@shared/domain'
import { logCommand } from '../../db/repos/commandLog'
import { describeHttpCall } from '../audit'
import { DEFAULT_MODELS } from '../models'
import { buildOpenRouterRequest, parseOpenRouterResponse } from '../parsers'
import { getDb } from '../registry'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * OpenRouter via REST — único provider com API key (os outros usam o login
 * local dos CLIs). A key vive no keychain e chega aqui por injeção; nunca é
 * logada nem devolvida ao renderer.
 *
 * O label é 'IA' porque o usuário escolhe o modelo real (de qualquer fabricante)
 * dentro do catálogo do OpenRouter — dizer "OpenRouter" na UI não informa nada.
 */

const TIMEOUT_MS = 240_000
const MODELS_URL = 'https://openrouter.ai/api/v1/models'
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000

export function createOpenRouterProvider(deps: {
  getApiKey: () => string | null
  fetchFn?: typeof fetch
}): AiProvider {
  const doFetch = deps.fetchFn ?? fetch

  return {
    id: 'openrouter',
    label: 'IA',
    kind: 'api',
    status(): AiProviderStatus {
      const key = deps.getApiKey()
      return { available: !!key, detail: key ? 'chave configurada' : 'sem chave de API' }
    },
    models() {
      // defaults mínimos: o catálogo completo vem por `ai:openrouterModels`
      return [{ id: DEFAULT_MODELS.openrouter.default, label: DEFAULT_MODELS.openrouter.default }]
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.openrouter[feature] ?? DEFAULT_MODELS.openrouter.default
    },
    async run(prompt: string, model: string) {
      const key = deps.getApiKey()
      if (!key)
        throw new AiUnavailableError('Sem chave de API do OpenRouter — configure em Ajustes')

      const { url, init } = buildOpenRouterRequest({ apiKey: key, model, prompt })
      const command = describeHttpCall('POST', url, model)
      const startedAt = Date.now()

      try {
        const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
        const body = await res.text()
        if (!res.ok) {
          throw new AiUnavailableError(
            `IA falhou (HTTP ${res.status}): ${messageFromBody(body, res.status)}`
          )
        }
        let json: unknown
        try {
          json = JSON.parse(body) as unknown
        } catch {
          throw new AiUnavailableError('Resposta da IA em formato inesperado')
        }
        const text = parseOpenRouterResponse(json)
        audit(command, Date.now() - startedAt, true, null)
        return text
      } catch (err) {
        const message = describeError(err)
        audit(command, Date.now() - startedAt, false, message)
        throw err instanceof AiUnavailableError ? err : new AiUnavailableError(message)
      }
    }
  }
}

let modelsCache: { at: number; models: Array<{ id: string; name: string }> } | null = null

/**
 * Catálogo de modelos do OpenRouter, ordenado por id. Cache de 1h no módulo —
 * a lista tem centenas de itens e muda pouco; `refresh` ignora o cache.
 */
export async function listOpenRouterModels(
  apiKey: string,
  refresh = false
): Promise<Array<{ id: string; name: string }>> {
  if (!refresh && modelsCache && Date.now() - modelsCache.at < MODELS_CACHE_TTL_MS) {
    return modelsCache.models
  }

  const command = describeHttpCall('GET', MODELS_URL, 'n/a')
  const startedAt = Date.now()
  try {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000)
    })
    const body = await res.text()
    if (!res.ok) {
      throw new AiUnavailableError(
        `Não foi possível listar os modelos (HTTP ${res.status}): ${messageFromBody(body, res.status)}`
      )
    }
    const parsed = JSON.parse(body) as { data?: Array<{ id?: unknown; name?: unknown }> }
    const models = (parsed.data ?? [])
      .filter((m): m is { id: string; name?: unknown } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id }))
      .sort((a, b) => a.id.localeCompare(b.id))

    modelsCache = { at: Date.now(), models }
    audit(command, Date.now() - startedAt, true, null)
    return models
  } catch (err) {
    const message = describeError(err)
    audit(command, Date.now() - startedAt, false, message)
    throw err instanceof AiUnavailableError ? err : new AiUnavailableError(message)
  }
}

/**
 * Valida a key contra a API antes de gravar no keychain (só o status HTTP
 * importa). Não vai para a auditoria: é uma verificação, não uma execução.
 */
export async function validateOpenRouterKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000)
    })
    return res.ok
  } catch {
    return false
  }
}

/** Mensagem de erro do corpo (error.message quando houver), sempre truncada. */
function messageFromBody(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: unknown } }
    const message = json.error?.message
    if (typeof message === 'string' && message.trim() !== '') return message.trim().slice(0, 300)
  } catch {
    // corpo não-JSON (ex.: HTML de proxy)
  }
  return body.trim().slice(0, 300) || `HTTP ${status}`
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `IA excedeu o tempo limite (${TIMEOUT_MS / 1000}s) — tente de novo ou simplifique o pedido`
    }
    return err.message
  }
  return String(err)
}

/** Auditoria é best-effort: nunca derruba a chamada. */
function audit(command: string, durationMs: number, ok: boolean, error: string | null): void {
  const db = getDb()
  if (!db) return
  try {
    logCommand(db, {
      kind: 'http',
      provider: 'openrouter',
      feature: null,
      command,
      durationMs,
      ok,
      error
    })
  } catch {
    // log é best-effort
  }
}
