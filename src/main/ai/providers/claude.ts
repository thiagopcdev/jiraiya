import { homedir } from 'os'
import { join } from 'path'
import type { AiFeature } from '@shared/domain'
import { findInPath, resolveBinary, runCliBinary } from '../exec'
import { DEFAULT_MODELS, CURATED_MODELS } from '../models'
import { parseClaudeOutput } from '../parsers'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * Claude via CLI `claude -p` (modo não-interativo). Usa a assinatura do login
 * local do Claude Code — sem API key.
 */

export function claudeCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): string[] {
  if (platform === 'win32') {
    return [
      // instalador nativo do Claude Code
      join(homedir(), '.local', 'bin', 'claude.exe'),
      // npm global
      join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'claude.cmd')
    ]
  }
  return [
    join(homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.claude', 'local', 'claude')
  ]
}

/** No Windows o prompt vai por stdin (argv multilinha não sobrevive ao cmd.exe dos shims). */
export function claudeInvocation(
  prompt: string,
  model: string,
  platform: NodeJS.Platform = process.platform
): { args: string[]; stdinText: string | null } {
  if (platform === 'win32') {
    return { args: ['-p', '--output-format', 'json', '--model', model], stdinText: prompt }
  }
  return { args: ['-p', prompt, '--output-format', 'json', '--model', model], stdinText: null }
}

function findClaude(): string | null {
  return resolveBinary(claudeCandidatePaths()) ?? findInPath('claude')
}

export function createClaudeProvider(): AiProvider {
  return {
    id: 'claude',
    label: 'Claude',
    kind: 'cli',
    status(): AiProviderStatus {
      const path = findClaude()
      return { available: path !== null, detail: path ?? 'CLI do Claude não encontrado' }
    },
    models() {
      return CURATED_MODELS.claude
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.claude[feature] ?? DEFAULT_MODELS.claude.default
    },
    async run(prompt: string, model: string) {
      const binary = findClaude()
      if (!binary) throw new AiUnavailableError('CLI do Claude não encontrado')
      const { args, stdinText } = claudeInvocation(prompt, model)
      const stdout = await runCliBinary({
        binary,
        args,
        stdinText,
        label: 'Claude',
        provider: 'claude'
      })
      return parseClaudeOutput(stdout)
    }
  }
}
