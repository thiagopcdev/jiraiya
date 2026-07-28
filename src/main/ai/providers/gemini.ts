import { homedir } from 'os'
import { join } from 'path'
import type { AiFeature } from '@shared/domain'
import { findInPath, resolveBinary, runCliBinary } from '../exec'
import { DEFAULT_MODELS, CURATED_MODELS } from '../models'
import { parseGeminiOutput } from '../parsers'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * Gemini via CLI `gemini -p` (modo não-interativo), usando o login local do
 * Gemini CLI. Instalação típica é por npm global — daí os caminhos extras.
 */

export function geminiCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): string[] {
  if (platform === 'win32') {
    return [join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'gemini.cmd')]
  }
  return [
    join(homedir(), '.local', 'bin', 'gemini'),
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    join(homedir(), '.npm-global', 'bin', 'gemini')
  ]
}

/** No Windows o prompt vai por stdin (sem `-p` — o CLI lê o pipe não-interativo). */
export function geminiInvocation(
  prompt: string,
  model: string,
  platform: NodeJS.Platform = process.platform
): { args: string[]; stdinText: string | null } {
  if (platform === 'win32') {
    return { args: ['-m', model, '--output-format', 'json'], stdinText: prompt }
  }
  return { args: ['-p', prompt, '-m', model, '--output-format', 'json'], stdinText: null }
}

function findGemini(): string | null {
  return resolveBinary(geminiCandidatePaths()) ?? findInPath('gemini')
}

export function createGeminiProvider(): AiProvider {
  return {
    id: 'gemini',
    label: 'Gemini',
    kind: 'cli',
    status(): AiProviderStatus {
      const path = findGemini()
      return { available: path !== null, detail: path ?? 'CLI do Gemini não encontrado' }
    },
    models() {
      return CURATED_MODELS.gemini
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.gemini[feature] ?? DEFAULT_MODELS.gemini.default
    },
    async run(prompt: string, model: string) {
      const binary = findGemini()
      if (!binary) throw new AiUnavailableError('CLI do Gemini não encontrado')
      const { args, stdinText } = geminiInvocation(prompt, model)
      const stdout = await runCliBinary({
        binary,
        args,
        stdinText,
        label: 'Gemini',
        provider: 'gemini'
      })
      return parseGeminiOutput(stdout)
    }
  }
}
