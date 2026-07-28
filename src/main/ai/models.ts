import type { AiFeature, AiProviderId, ClaudeModel, Prefs } from '@shared/domain'

/**
 * Catálogo de modelos por provider e resolução do modelo de cada função.
 *
 * CLIs têm lista CURADA (o CLI é que resolve o alias para a versão mais nova);
 * o OpenRouter tem catálogo de centenas de modelos e vem pelo canal
 * `ai:openrouterModels`, então aqui só existem os defaults mínimos.
 */

export const CURATED_MODELS: Record<
  Exclude<AiProviderId, 'openrouter'>,
  Array<{ id: string; label: string }>
> = {
  claude: [
    { id: 'haiku', label: 'Haiku (mais rápido)' },
    { id: 'sonnet', label: 'Sonnet (equilíbrio)' },
    { id: 'opus', label: 'Opus (mais capaz)' }
  ],
  // atualizar quando o Google renomear
  gemini: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' }
  ],
  // atualizar quando a OpenAI renomear
  codex: [
    { id: 'gpt-5.1-codex-max', label: 'Codex Max' },
    { id: 'gpt-5.1-codex-mini', label: 'Codex Mini' },
    { id: 'gpt-5.1', label: 'GPT-5.1' }
  ]
}

/**
 * Default por função: o barato para tarefas de reescrita, o mais capaz para
 * divisão de card e perguntas abertas (mesma lógica dos prefs legados).
 */
export const DEFAULT_MODELS: Record<
  AiProviderId,
  Partial<Record<AiFeature, string>> & { default: string }
> = {
  claude: { default: 'sonnet', split: 'opus', ask: 'opus' },
  gemini: { default: 'gemini-2.5-flash', split: 'gemini-2.5-pro', ask: 'gemini-2.5-pro' },
  codex: { default: 'gpt-5.1-codex-mini', split: 'gpt-5.1-codex-max', ask: 'gpt-5.1-codex-max' },
  openrouter: { default: 'openai/gpt-5-mini' }
}

/** Prefs legados (só claude): a escolha antiga do usuário continua valendo. */
const LEGACY_CLAUDE_PREF: Record<AiFeature, keyof Prefs> = {
  summaries: 'modelSummaries',
  team: 'modelTeam',
  draft: 'modelDraft',
  split: 'modelSplit',
  comment: 'modelComment',
  ask: 'modelAsk'
}

/**
 * Modelo efetivo de uma função: escolha explícita em `aiModels` → pref legado
 * do claude → default da função → default do provider.
 */
export function modelFor(feature: AiFeature, providerId: AiProviderId, prefs: Prefs): string {
  const chosen = prefs.aiModels?.[providerId]?.[feature]
  if (typeof chosen === 'string' && chosen.trim() !== '') return chosen

  if (providerId === 'claude') {
    const legacy = prefs[LEGACY_CLAUDE_PREF[feature]] as ClaudeModel | undefined
    if (typeof legacy === 'string' && legacy.trim() !== '') return legacy
  }

  const defaults = DEFAULT_MODELS[providerId]
  return defaults[feature] ?? defaults.default
}
