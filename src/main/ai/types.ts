import type { AiFeature, AiProviderId } from '@shared/domain'

/**
 * Contrato da camada de providers de IA (Claude/Gemini/Codex via CLI, OpenRouter via REST).
 * CONGELADO na fundação da rodada — implementações em ai/providers/*, consumo via ai/service.ts.
 */

/** Qualquer falha de IA vira este erro; quem chama decide entre fallback e AppError. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

export interface AiProviderStatus {
  available: boolean
  /** path do binário | 'chave configurada' | motivo da indisponibilidade */
  detail: string | null
}

export interface AiProvider {
  readonly id: AiProviderId
  /** nome exibido na UI ('Claude' | 'Gemini' | 'Codex' | 'IA') */
  readonly label: string
  readonly kind: 'cli' | 'api'
  /** síncrono: existsSync do binário / presença da key */
  status(): AiProviderStatus
  /** lista curada (CLIs) ou defaults mínimos (openrouter) para os selects da UI */
  models(): Array<{ id: string; label: string }>
  defaultModel(feature: AiFeature): string
  /** executa o prompt; qualquer falha lança AiUnavailableError */
  run(prompt: string, model: string): Promise<string>
}
