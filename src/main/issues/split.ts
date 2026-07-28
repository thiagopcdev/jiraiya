import { z } from 'zod'
import { runAiPrompt } from '../ai/service'
import { extractJson } from '../ai/text'
import { CARD_PATTERN, patternBlockFor } from './cardPattern'

export interface SplitItem {
  title: string
  description: string
}

const splitSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        description: z.string()
      })
    )
    .min(1)
    .max(10),
  rationale: z.string().trim().max(1000).default('')
})

/**
 * Extrai o JSON da resposta da IA (tira a cerca ```json e recorta do primeiro '{'
 * ao último '}') e valida. rationale ausente → '' (default). Falha → Error amigável.
 */
export function parseSplitResponse(raw: string): { items: SplitItem[]; rationale: string } {
  try {
    const parsed = splitSchema.parse(JSON.parse(extractJson(raw)))
    return {
      items: parsed.items.map((i) => ({
        title: i.title.trim(),
        description: i.description.trim()
      })),
      rationale: parsed.rationale.trim()
    }
  } catch {
    throw new Error('Resposta da IA em formato inesperado')
  }
}

/**
 * Monta o prompt pt-BR no padrão Biud e pede à IA para dividir um card em
 * 2 a 6 cards menores, independentes e verificáveis isoladamente. Suporta
 * iteração com feedback do usuário sobre itens já editados.
 */
export async function splitIssue(input: {
  parentKey: string
  parentTitle: string
  parentDescription: string | null
  parentIssueType: string | null
  feedback?: string
  currentItems?: SplitItem[]
}): Promise<{ items: SplitItem[]; rationale: string }> {
  const bloco = patternBlockFor(input.parentIssueType)
  const isIteration = Boolean(input.currentItems?.length)

  const prompt = [
    'Você é um redator de cards do Jira do time da Biud. Divida o card abaixo em 2 a 6 cards',
    'menores, independentes entre si e verificáveis isoladamente — cada um entregável sozinho.',
    '',
    '=== CARD ORIGINAL ===',
    `Key: ${input.parentKey}`,
    `Tipo: ${input.parentIssueType ?? 'desconhecido'}`,
    `Título: ${input.parentTitle}`,
    'Descrição:',
    input.parentDescription?.trim() ||
      '(card sem descrição — baseie-se apenas no título e seja conservador)',
    '',
    'Cada card gerado segue este padrão de título e descrição:',
    '',
    CARD_PATTERN.titulo,
    '',
    bloco,
    '',
    'REGRAS:',
    '- Escreva em português do Brasil.',
    '- Use SOMENTE esta marcação: "###" para seções, "**negrito**", "- " para bullets e',
    '  "- [ ]"/"- [x]" para checklists. NÃO use "#"/"##", itálico, links, tabelas ou blocos de código.',
    '- NÃO invente requisitos que não estejam no card original nem sejam implicação direta dele.',
    '- Na descrição JSON, represente as quebras de linha como \\n.',
    ...(isIteration
      ? [
          '',
          '=== ITENS ATUAIS (já editados pelo usuário) ===',
          JSON.stringify(input.currentItems, null, 2),
          '',
          '=== FEEDBACK DO USUÁRIO ===',
          input.feedback ?? '(sem feedback — apenas melhore a divisão)',
          '',
          'Ajuste os itens conforme o feedback. PRESERVE título e descrição dos itens que o feedback',
          'não pedir para mudar — eles contêm edições manuais do usuário.'
        ]
      : []),
    '',
    'Responda SOMENTE com JSON válido no formato {"items":[{"title":"...","description":"..."}], "rationale":"..."} — rationale com 1-2 frases explicando o critério da divisão. Sem cerca de código, sem texto antes ou depois.'
  ].join('\n')

  const raw = await runAiPrompt('split', prompt)
  return parseSplitResponse(raw)
}
