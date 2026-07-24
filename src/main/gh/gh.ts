import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Integração opcional com o GitHub via CLI `gh`. Apps GUI no macOS não herdam
 * o PATH do shell, então o binário é resolvido explicitamente nos caminhos
 * usuais (mesmo padrão de summaries/claude.ts). Ausência do gh nunca quebra —
 * a integração de PRs é opcional e silenciosa.
 */

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  join(homedir(), '.local', 'bin', 'gh'),
  '/usr/bin/gh'
]

export function resolveGhBinary(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

export function ghAvailable(): boolean {
  return resolveGhBinary() !== null
}

/**
 * Executa o `gh` com os argumentos dados e devolve stdout. Binário ausente ou
 * erro do processo → lança Error com mensagem curta (stderr truncado a 200 chars).
 */
export async function runGh(args: string[], timeoutMs = 20_000): Promise<string> {
  const binary = resolveGhBinary()
  if (!binary) throw new Error('CLI do gh não encontrado')

  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env } },
      (err, stdout, stderr) => {
        if (err) {
          if (err.killed || err.signal === 'SIGTERM') {
            reject(new Error('gh excedeu o tempo limite'))
            return
          }
          const stderrText = stderr?.toString().trim().slice(0, 200)
          reject(new Error(`gh falhou: ${stderrText || err.message}`))
          return
        }
        resolve(stdout.toString())
      }
    )
    child.stdin?.end()
  })
}
