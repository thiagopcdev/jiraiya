import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { logCommand } from '../db/repos/commandLog'
import { redactCommandLine } from './audit'
import { getDb } from './registry'
import { AiUnavailableError } from './types'

/**
 * Transporte comum dos providers de IA que são CLI (claude, gemini, codex).
 *
 * Apps GUI no macOS não herdam o PATH do shell, então cada provider resolve o
 * binário explicitamente (ver resolveBinary) e passa o caminho absoluto aqui.
 * Toda execução é auditada em command_log (best-effort) com a linha de comando
 * já redigida — nunca o env.
 */

const DEFAULT_TIMEOUT_MS = 240_000
const MAX_BUFFER = 8 * 1024 * 1024

/** Primeiro caminho existente da lista de candidatos; null se nenhum. */
export function resolveBinary(candidates: string[]): string | null {
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

/**
 * Fallback: procura o binário no PATH do processo. No Windows apps herdam o
 * PATH do usuário normalmente (scoop/winget/npm etc.), então isso cobre
 * instalações fora dos caminhos candidatos. Extensões vêm do PATHEXT
 * (limitadas a exe/cmd/bat — as executáveis sem interpretador externo).
 */
export function findInPath(
  name: string,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  const win = platform === 'win32'
  const dirs = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean)
  const exts = win
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT')
        .split(';')
        .map((e) => e.toLowerCase())
        .filter((e) => e === '.exe' || e === '.cmd' || e === '.bat')
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Shims .cmd/.bat (npm no Windows) só rodam via shell (bloqueio do Node pós CVE-2024-27980). */
export function isWindowsShim(binary: string): boolean {
  return /\.(cmd|bat)$/i.test(binary)
}

/**
 * Executa um CLI e devolve o stdout cru (cada provider faz o próprio parse).
 * Qualquer falha vira AiUnavailableError com mensagem curta em pt-BR.
 */
export async function runCliBinary(input: {
  binary: string
  args: string[]
  /** nome exibido nas mensagens de erro ('Claude', 'Gemini', 'Codex') */
  label: string
  /** id do provider, para a auditoria */
  provider: string
  /**
   * prompt via stdin (Windows): argv não comporta prompt multilinha através do
   * cmd.exe dos shims .cmd; null = argv como sempre (Unix)
   */
  stdinText?: string | null
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startedAt = Date.now()
  const shim = isWindowsShim(input.binary)

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        // com shell, o caminho precisa de aspas próprias (espaços em C:\Users\…)
        shim ? `"${input.binary}"` : input.binary,
        input.args,
        {
          timeout: timeoutMs,
          maxBuffer: MAX_BUFFER,
          cwd: app.getPath('userData'),
          env: { ...process.env },
          // shims .cmd/.bat exigem shell; args aqui são só flags + modelo
          // validado (o prompt vai por stdin nesse caso — nunca pelo argv)
          shell: shim,
          windowsHide: true
        },
        (err, stdout, stderr) => {
          if (err) {
            // processo morto pelo timeout do execFile → mensagem específica
            if (err.killed || err.signal === 'SIGTERM') {
              reject(
                new AiUnavailableError(
                  `CLI do ${input.label} excedeu o tempo limite (${timeoutMs / 1000}s) — tente de novo ou simplifique o pedido`
                )
              )
              return
            }
            reject(
              new AiUnavailableError(
                `CLI do ${input.label} falhou: ${cleanStderr(stderr) || err.message}`
              )
            )
            return
          }
          resolve(stdout.toString())
        }
      )
      // escreve o prompt quando via stdin; fechar SEMPRE — CLI com pipe aberto
      // fica esperando dados e emite warning
      if (input.stdinText != null) child.stdin?.write(input.stdinText)
      child.stdin?.end()
    })

    audit(input, Date.now() - startedAt, true, null)
    return stdout
  } catch (err) {
    audit(input, Date.now() - startedAt, false, err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** Warnings no stderr (ex.: aviso de stdin) não são a causa da falha — filtra. */
function cleanStderr(stderr: string | Buffer | undefined): string {
  return (
    stderr
      ?.toString()
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('Warning:'))
      .join('\n')
      .slice(0, 300) ?? ''
  )
}

/** Auditoria é best-effort: nunca derruba a execução do prompt. */
function audit(
  input: { binary: string; args: string[]; provider: string; stdinText?: string | null },
  durationMs: number,
  ok: boolean,
  error: string | null
): void {
  const db = getDb()
  if (!db) return
  try {
    const stdinNote =
      input.stdinText != null ? ` < prompt via stdin (${input.stdinText.length} chars)` : ''
    logCommand(db, {
      kind: 'cli',
      provider: input.provider,
      feature: null,
      command: redactCommandLine(input.binary, input.args) + stdinNote,
      durationMs,
      ok,
      error
    })
  } catch {
    // log é best-effort
  }
}
