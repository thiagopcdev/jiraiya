import { z } from 'zod'
import { runClaudePrompt } from '../summaries/claude'
import type { ClaudeModel } from '@shared/domain'
import { CARD_PATTERN, patternBlockFor } from './cardPattern'

const draftSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string()
})

/**
 * Extrai o JSON do texto do Claude (tolera cerca ```json e preâmbulo) e valida.
 * Qualquer falha → Error com mensagem amigável.
 */
export function parseDraftResponse(raw: string): { title: string; description: string } {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || end < start) {
      throw new Error('sem objeto JSON')
    }
    const parsed = draftSchema.parse(JSON.parse(raw.slice(start, end + 1)))
    return { title: parsed.title.trim(), description: parsed.description.trim() }
  } catch {
    throw new Error('Resposta do Claude em formato inesperado')
  }
}

/**
 * Monta o prompt pt-BR no padrão Biud (bloco História ou Tarefa/Bug conforme o tipo)
 * e gera um rascunho de título + descrição via CLI do Claude.
 */
export async function draftIssueWithClaude(input: {
  idea: string
  projectKey: string
  issueType: string
  model?: ClaudeModel
}): Promise<{ title: string; description: string }> {
  const bloco = patternBlockFor(input.issueType)

  const prompt = [
    'Você é um redator de cards do Jira do time da Biud. A partir da ideia abaixo, escreva',
    'o título e a descrição de um card no padrão do time.',
    '',
    `Projeto: ${input.projectKey}. Tipo de issue: ${input.issueType}.`,
    '',
    CARD_PATTERN.titulo,
    '',
    bloco,
    '',
    'REGRAS:',
    '- Escreva em português do Brasil.',
    '- Use SOMENTE esta marcação: "###" para seções, "**negrito**", "- " para bullets e',
    '  "- [ ]"/"- [x]" para checklists. NÃO use "#"/"##", itálico, links, tabelas ou blocos de código.',
    '- NÃO invente requisitos que não estejam na ideia nem sejam implicação direta dela.',
    '- Cada cenário Gherkin cobre um único comportamento.',
    '- Na descrição JSON, represente as quebras de linha como \\n.',
    '',
    '=== IDEIA ===',
    input.idea,
    '',
    'Responda SOMENTE com JSON válido no formato {"title": "...", "description": "..."} — sem cerca de código, sem texto antes ou depois.'
  ].join('\n')

  const raw = await runClaudePrompt(prompt, input.model)
  return parseDraftResponse(raw)
}
