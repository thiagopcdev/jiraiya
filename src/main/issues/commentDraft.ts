import { runClaudePrompt } from '../summaries/claude'
import type { ClaudeModel } from '@shared/domain'

/**
 * Reescreve notas soltas como um comentário estruturado de Jira no padrão da
 * Biud: resumo executivo no topo (para PO/QA) e, quando as notas justificarem,
 * seções técnicas. Devolve o markdown cru do Claude (sem parse de JSON).
 */
export async function draftCommentWithClaude(input: {
  issueKey: string
  issueSummary: string
  notes: string
  model?: ClaudeModel
}): Promise<string> {
  const prompt = [
    'Você redige comentários de Jira do time da Biud.',
    `Reescreva as notas abaixo como um comentário estruturado para o card ${input.issueKey} (${input.issueSummary}).`,
    '',
    'REGRAS:',
    '- Comece SEMPRE com um resumo executivo de 2 a 4 frases em português do Brasil claro, sem jargão técnico (para PO/QA).',
    '- Depois, SE as notas justificarem, use as seções "### O que foi feito" (bullets técnicos), "### Resultado esperado" e "### Para validação no QA".',
    '- NÃO invente fatos que não estejam nas notas.',
    '- Use SOMENTE esta marcação: "###" para seções, "**negrito**" e "- " para bullets.',
    '- Responda SOMENTE com o markdown do comentário, sem preâmbulo nem cerca de código.',
    '',
    '=== NOTAS ===',
    input.notes
  ].join('\n')

  return runClaudePrompt(prompt, input.model)
}
