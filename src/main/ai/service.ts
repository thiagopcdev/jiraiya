import type { AiFeature, AiProviderId, Prefs } from '@shared/domain'
import { DEFAULT_PREFS } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { getPrefs } from '../db/repos/misc'
import { modelFor } from './models'
import { getDb, getProviders, resolveActiveProviderId } from './registry'
import { stripOuterCodeFence } from './text'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from './types'

/**
 * Fachada da camada de IA para o resto do main: quem chama pede a função
 * (summaries, split, ask…) e recebe texto — sem saber qual provider respondeu
 * nem qual modelo foi usado.
 */

function prefs(): Prefs {
  const db = getDb()
  return db ? getPrefs(db) : { ...DEFAULT_PREFS }
}

/** Snapshot para o canal `ai:status`: providers, disponibilidade e ativo. */
export function aiStatus(): IpcResponse<'ai:status'> {
  const statuses = {} as Record<AiProviderId, AiProviderStatus>
  const providers = getProviders()

  const list = providers.map((provider) => {
    const status = provider.status()
    statuses[provider.id] = status
    return {
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
      available: status.available,
      detail: status.detail,
      models: provider.models()
    }
  })

  const activePref = prefs().aiProvider
  const activeId = resolveActiveProviderId(activePref, statuses)
  const active = providers.find((p) => p.id === activeId)

  return {
    providers: list,
    active: active ? { id: active.id, label: active.label } : null,
    activePref
  }
}

/** Provider em uso agora; null quando nenhum está disponível. */
export function activeProvider(): AiProvider | null {
  const providers = getProviders()
  const statuses = {} as Record<AiProviderId, AiProviderStatus>
  for (const provider of providers) statuses[provider.id] = provider.status()

  const activeId = resolveActiveProviderId(prefs().aiProvider, statuses)
  return providers.find((p) => p.id === activeId) ?? null
}

/**
 * Executa um prompt na função pedida, com o modelo configurado para ela.
 * Qualquer falha vira AiUnavailableError — quem chama decide o fallback.
 */
export async function runAiPrompt(feature: AiFeature, prompt: string): Promise<string> {
  const provider = activeProvider()
  if (!provider) {
    throw new AiUnavailableError('Nenhum provider de IA disponível — configure em Ajustes')
  }
  const model = modelFor(feature, provider.id, prefs())
  const output = await provider.run(prompt, model)
  // modelos costumam embalar a resposta inteira num bloco de código
  return stripOuterCodeFence(output)
}
