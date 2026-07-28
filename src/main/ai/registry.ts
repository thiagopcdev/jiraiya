import type Database from 'better-sqlite3'
import type { AiProviderId, AiProviderPref } from '@shared/domain'
import { createClaudeProvider } from './providers/claude'
import { createCodexProvider } from './providers/codex'
import { createGeminiProvider } from './providers/gemini'
import { createOpenRouterProvider } from './providers/openrouter'
import type { AiProvider, AiProviderStatus } from './types'

/**
 * Registro dos providers de IA: instancia uma vez, guarda as dependências de
 * runtime (db para a auditoria, acesso à key do OpenRouter) e resolve qual
 * provider está ativo.
 */

/** Ordem de preferência do modo 'auto' — e a ordem de exibição na UI. */
const PROVIDER_ORDER: AiProviderId[] = ['claude', 'gemini', 'codex', 'openrouter']

/**
 * Provider ativo dado o pref e o status de cada um. Pref explícito NÃO cai para
 * outro provider: se o usuário escolheu Gemini e o CLI não está lá, a resposta é
 * "nenhum" — silenciosamente trocar de IA seria pior que falhar.
 */
export function resolveActiveProviderId(
  pref: AiProviderPref,
  statuses: Record<AiProviderId, AiProviderStatus>
): AiProviderId | null {
  if (pref !== 'auto') return statuses[pref]?.available ? pref : null
  return PROVIDER_ORDER.find((id) => statuses[id]?.available) ?? null
}

let db: Database.Database | null = null
let openRouterKeyGetter: () => string | null = () => null
let providers: AiProvider[] | null = null

/** Construção tardia: evita depender da ordem de carga dos módulos. */
function ensureProviders(): AiProvider[] {
  if (!providers) {
    providers = [
      createClaudeProvider(),
      createGeminiProvider(),
      createCodexProvider(),
      createOpenRouterProvider({ getApiKey: () => openRouterKeyGetter() })
    ]
  }
  return providers
}

export function initAiRegistry(deps: {
  db: Database.Database
  getOpenRouterKey: () => string | null
}): void {
  db = deps.db
  openRouterKeyGetter = deps.getOpenRouterKey
  ensureProviders()
}

/** Todos os providers, sempre na mesma ordem (claude, gemini, codex, openrouter). */
export function getProviders(): AiProvider[] {
  return ensureProviders()
}

/** DB para a auditoria best-effort; null antes do init (ex.: em teste). */
export function getDb(): Database.Database | null {
  return db
}
