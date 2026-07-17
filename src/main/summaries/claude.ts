import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'

/**
 * Integração com Claude via CLI `claude -p` (modo não-interativo).
 * Usa a assinatura do login local do Claude Code — sem API key.
 * Camada isolada: qualquer falha cai no template determinístico.
 *
 * Apps GUI no macOS não herdam o PATH do shell, então o binário é
 * resolvido explicitamente nos caminhos usuais.
 */

const CANDIDATE_PATHS = [
  join(homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  join(homedir(), '.claude', 'local', 'claude')
]

const TIMEOUT_MS = 90_000

export function resolveClaudeBinary(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

export function claudeStatus(): { available: boolean; path: string | null } {
  const path = resolveClaudeBinary()
  return { available: path !== null, path }
}

export class ClaudeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeUnavailableError'
  }
}

interface ClaudeCliResult {
  result?: string
  is_error?: boolean
  subtype?: string
}

/**
 * Executa um prompt no CLI do Claude e devolve o texto do resultado.
 * Lança ClaudeUnavailableError em qualquer falha — o chamador decide o fallback.
 */
export async function runClaudePrompt(prompt: string): Promise<string> {
  const binary = resolveClaudeBinary()
  if (!binary) throw new ClaudeUnavailableError('CLI do Claude não encontrado')

  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      ['-p', prompt, '--output-format', 'json', '--model', 'sonnet'],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        cwd: app.getPath('userData'),
        env: { ...process.env }
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new ClaudeUnavailableError(
              `CLI do Claude falhou: ${stderr?.toString().slice(0, 300) || err.message}`
            )
          )
          return
        }
        resolve(stdout.toString())
      }
    )
  })

  let parsed: ClaudeCliResult
  try {
    parsed = JSON.parse(output) as ClaudeCliResult
  } catch {
    throw new ClaudeUnavailableError('Resposta do CLI do Claude em formato inesperado')
  }
  if (parsed.is_error || typeof parsed.result !== 'string' || parsed.result.trim() === '') {
    throw new ClaudeUnavailableError('Claude retornou erro ou resposta vazia')
  }
  return parsed.result.trim()
}

/**
 * Reescreve o markdown do template com o Claude. Lança ClaudeUnavailableError
 * em qualquer falha — o chamador decide o fallback.
 */
export function enhanceWithClaude(input: {
  templateMarkdown: string
  digestJson: string
}): Promise<string> {
  const prompt = [
    'Você recebe um resumo de trabalho gerado automaticamente a partir de dados do Jira, mais o JSON com os fatos brutos.',
    'Reescreva o resumo em português do Brasil, com tom profissional e conciso, bom para colar numa daily/weekly.',
    'Regras: não invente fatos; mantenha as chaves dos tickets (ex.: BT-123) exatamente como estão; mantenha a estrutura de seções em markdown; agrupe itens relacionados quando fizer sentido; corte redundância.',
    'Responda SOMENTE com o markdown final, sem preâmbulo.',
    '',
    '=== RESUMO (template) ===',
    input.templateMarkdown,
    '',
    '=== FATOS (JSON) ===',
    input.digestJson
  ].join('\n')
  return runClaudePrompt(prompt)
}

/**
 * Resumo do time em uma única chamada ao Claude (todos os membros de uma vez —
 * evita N chamadas caras). Foco em colaboração/awareness, não em ranking.
 */
export function summarizeTeamWithClaude(input: {
  periodLabel: string
  teamJson: string
}): Promise<string> {
  const prompt = [
    'Você recebe, em JSON, o que cada membro de um time está fazendo no Jira em um período: trabalho em andamento, entregas, tickets parados e contagens de atividade.',
    `Período: ${input.periodLabel}.`,
    'Escreva um panorama do time em português do Brasil, curto e útil para alguém se situar antes de uma reunião.',
    'Foque em: o que está em andamento, quem está bloqueado ou com tickets parados, e onde pode haver necessidade de sincronizar/ajudar.',
    'NÃO faça ranking de produtividade nem compare desempenho entre pessoas. Não invente fatos. Mantenha as chaves dos tickets (ex.: BT-123).',
    'Formato: um parágrafo curto por pessoa (comece com o nome em negrito), ou bullets. Responda SOMENTE com o markdown, sem preâmbulo.',
    '',
    '=== TIME (JSON) ===',
    input.teamJson
  ].join('\n')
  return runClaudePrompt(prompt)
}
