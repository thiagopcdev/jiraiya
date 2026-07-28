import { homedir } from 'os'
import { join } from 'path'
import type { AiFeature } from '@shared/domain'
import { resolveBinary, runCliBinary } from '../exec'
import { DEFAULT_MODELS, CURATED_MODELS } from '../models'
import { parseGeminiOutput } from '../parsers'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * Gemini via CLI `gemini -p` (modo não-interativo), usando o login local do
 * Gemini CLI. Instalação típica é por npm global — daí os caminhos extras.
 */

const CANDIDATE_PATHS = [
  join(homedir(), '.local', 'bin', 'gemini'),
  '/opt/homebrew/bin/gemini',
  '/usr/local/bin/gemini',
  join(homedir(), '.npm-global', 'bin', 'gemini')
]

export function createGeminiProvider(): AiProvider {
  return {
    id: 'gemini',
    label: 'Gemini',
    kind: 'cli',
    status(): AiProviderStatus {
      const path = resolveBinary(CANDIDATE_PATHS)
      return { available: path !== null, detail: path ?? 'CLI do Gemini não encontrado' }
    },
    models() {
      return CURATED_MODELS.gemini
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.gemini[feature] ?? DEFAULT_MODELS.gemini.default
    },
    async run(prompt: string, model: string) {
      const binary = resolveBinary(CANDIDATE_PATHS)
      if (!binary) throw new AiUnavailableError('CLI do Gemini não encontrado')
      const stdout = await runCliBinary({
        binary,
        args: ['-p', prompt, '-m', model, '--output-format', 'json'],
        label: 'Gemini',
        provider: 'gemini'
      })
      return parseGeminiOutput(stdout)
    }
  }
}
