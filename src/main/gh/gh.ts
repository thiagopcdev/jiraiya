import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { logCommand } from '../db/repos/commandLog'
import { redactCommandLine } from '../ai/audit'

/**
 * Integração opcional com o GitHub via CLI `gh`. Apps GUI no macOS não herdam
 * o PATH do shell, então o binário é resolvido explicitamente nos caminhos
 * usuais (mesmo padrão dos providers de IA em ai/providers/*). Ausência do gh
 * nunca quebra — a integração de PRs é opcional e silenciosa.
 */

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  join(homedir(), '.local', 'bin', 'gh'),
  '/usr/bin/gh'
]

/**
 * DB da auditoria de comandos. Module-level porque runGh é chamado de vários
 * pontos sem ctx; sem init (testes) o log é simplesmente ignorado.
 */
let auditDb: Database.Database | null = null

export function initGhLogging(db: Database.Database): void {
  auditDb = db
}

/** Log best-effort: falha na auditoria nunca afeta o resultado do comando. */
function audit(
  binary: string,
  args: string[],
  durationMs: number,
  ok: boolean,
  error: string | null
): void {
  if (!auditDb) return
  try {
    logCommand(auditDb, {
      kind: 'cli',
      provider: 'gh',
      feature: null,
      command: redactCommandLine(binary, args),
      durationMs,
      ok,
      error
    })
  } catch {
    // auditoria é acessória — silencia
  }
}

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
 * Cada execução entra na auditoria de comandos (linha já redigida).
 */
export async function runGh(args: string[], timeoutMs = 20_000): Promise<string> {
  const binary = resolveGhBinary()
  if (!binary) throw new Error('CLI do gh não encontrado')

  const startedAt = Date.now()
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env } },
      (err, stdout, stderr) => {
        if (err) {
          const message =
            err.killed || err.signal === 'SIGTERM'
              ? 'gh excedeu o tempo limite'
              : `gh falhou: ${stderr?.toString().trim().slice(0, 200) || err.message}`
          audit(binary, args, Date.now() - startedAt, false, message)
          reject(new Error(message))
          return
        }
        audit(binary, args, Date.now() - startedAt, true, null)
        resolve(stdout.toString())
      }
    )
    child.stdin?.end()
  })
}
