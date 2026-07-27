import type { AskAction, ClaudeModel } from '@shared/domain'
import { runClaudePrompt } from '../summaries/claude'
import { ACTIONS_PROMPT, parseAskResponse } from './actions'

/** Monta o prompt pt-BR do "Pergunte ao Jiraiya". Pura — testável sem CLI. */
export function buildAskPrompt(input: {
  question: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  snapshotJson: string
  todayIso: string
}): string {
  const parts: string[] = [
    'Você é o Jiraiya, assistente pessoal de Jira do usuário. Responda a pergunta usando SOMENTE os dados do snapshot JSON abaixo (dados locais sincronizados do Jira dele). Hoje é ' +
      input.todayIso +
      '.',
    'Regras:',
    '- responda em português do Brasil, direto e específico;',
    '- cite as keys dos cards (ex.: BT-123) sempre que se referir a eles;',
    "- se o snapshot não tiver a informação, diga claramente o que falta (ex.: 'os dados locais cobrem só a janela de backfill') em vez de inventar;",
    '- formate com markdown leve (negrito, listas).'
  ]

  if (input.history && input.history.length > 0) {
    parts.push('', '=== CONVERSA ANTERIOR ===')
    for (const turn of input.history) {
      const who = turn.role === 'user' ? 'Usuário' : 'Jiraiya'
      parts.push(`${who}: ${turn.content}`)
    }
  }

  parts.push(
    '',
    ACTIONS_PROMPT,
    '',
    '=== DADOS (snapshot) ===',
    input.snapshotJson,
    '',
    '=== PERGUNTA ===',
    input.question
  )

  return parts.join('\n')
}

/**
 * Executa a pergunta no CLI do Claude e separa a resposta em texto + ações
 * propostas (as ações só rodam depois de confirmação do usuário, via ask:execute).
 */
export async function askJiraiya(input: {
  question: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  snapshotJson: string
  todayIso: string
  model?: ClaudeModel
}): Promise<{ answer: string; actions: AskAction[] }> {
  const prompt = buildAskPrompt(input)
  const raw = await runClaudePrompt(prompt, input.model)
  return parseAskResponse(raw)
}
