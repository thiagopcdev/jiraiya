import { randomUUID } from 'crypto'
import { readFileSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { AiFeature } from '@shared/domain'
import { findInPath, resolveBinary, runCliBinary } from '../exec'
import { DEFAULT_MODELS, CURATED_MODELS } from '../models'
import { AiUnavailableError, type AiProvider, type AiProviderStatus } from '../types'

/**
 * Codex via CLI `codex exec` (modo não-interativo), usando o login local.
 *
 * Duas particularidades do codex:
 * - o stdout é poluído com logs de execução, então a resposta é lida do arquivo
 *   apontado por `--output-last-message`;
 * - `--skip-git-repo-check` é obrigatório: o cwd é o userData do app, que não é
 *   um repositório git, e sem a flag o CLI se recusa a rodar.
 * `--sandbox read-only` porque só queremos texto — nada de escrita em disco.
 */

export function codexCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): string[] {
  if (platform === 'win32') {
    return [
      join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'codex.cmd'),
      join(homedir(), '.cargo', 'bin', 'codex.exe')
    ]
  }
  return [
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.local', 'bin', 'codex'),
    join(homedir(), '.npm-global', 'bin', 'codex'),
    join(homedir(), '.cargo', 'bin', 'codex')
  ]
}

/** No Windows o prompt vai por stdin (`codex exec -` lê o pipe). */
export function codexInvocation(
  prompt: string,
  model: string,
  outFile: string,
  platform: NodeJS.Platform = process.platform
): { args: string[]; stdinText: string | null } {
  const tail = [
    '-m',
    model,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--output-last-message',
    outFile
  ]
  if (platform === 'win32') return { args: ['exec', '-', ...tail], stdinText: prompt }
  return { args: ['exec', prompt, ...tail], stdinText: null }
}

function findCodex(): string | null {
  return resolveBinary(codexCandidatePaths()) ?? findInPath('codex')
}

export function createCodexProvider(): AiProvider {
  return {
    id: 'codex',
    label: 'Codex',
    kind: 'cli',
    status(): AiProviderStatus {
      const path = findCodex()
      return { available: path !== null, detail: path ?? 'CLI do Codex não encontrado' }
    },
    models() {
      return CURATED_MODELS.codex
    },
    defaultModel(feature: AiFeature) {
      return DEFAULT_MODELS.codex[feature] ?? DEFAULT_MODELS.codex.default
    },
    async run(prompt: string, model: string) {
      const binary = findCodex()
      if (!binary) throw new AiUnavailableError('CLI do Codex não encontrado')

      const outFile = join(tmpdir(), `jiraiya-codex-${randomUUID()}.txt`)
      try {
        const { args, stdinText } = codexInvocation(prompt, model, outFile)
        await runCliBinary({
          binary,
          args,
          stdinText,
          label: 'Codex',
          provider: 'codex'
        })

        let text = ''
        try {
          text = readFileSync(outFile, 'utf8').trim()
        } catch {
          text = ''
        }
        if (text === '') throw new AiUnavailableError('Codex retornou resposta vazia')
        return text
      } finally {
        try {
          rmSync(outFile, { force: true })
        } catch {
          // arquivo temporário: limpeza é best-effort
        }
      }
    }
  }
}
