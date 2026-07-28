import { homedir } from 'os'
import { join } from 'path'
import type { AiFeature } from '@shared/domain'
import { resolveBinary, runCliBinary } from '../exec'
import { DEFAULT_MODELS, CURATED_MODELS } from '../models'
import { parseClaudeOutput } from '../parsers'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * Claude via CLI `claude -p` (modo não-interativo). Usa a assinatura do login
 * local do Claude Code — sem API key.
 */

const CANDIDATE_PATHS = [
  join(homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.claude', 'local', 'claude')
]

export function createClaudeProvider(): AiProvider {
  return {
    id: 'claude',
    label: 'Claude',
    kind: 'cli',
    status(): AiProviderStatus {
      const path = resolveBinary(CANDIDATE_PATHS)
      return { available: path !== null, detail: path ?? 'CLI do Claude não encontrado' }
    },
    models() {
      return CURATED_MODELS.claude
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.claude[feature] ?? DEFAULT_MODELS.claude.default
    },
    async run(prompt: string, model: string) {
      const binary = resolveBinary(CANDIDATE_PATHS)
      if (!binary) throw new AiUnavailableError('CLI do Claude não encontrado')
      const stdout = await runCliBinary({
        binary,
        args: ['-p', prompt, '--output-format', 'json', '--model', model],
        label: 'Claude',
        provider: 'claude'
      })
      return parseClaudeOutput(stdout)
    }
  }
}
