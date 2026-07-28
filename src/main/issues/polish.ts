/**
 * "Melhorar com IA" de texto livre: reformata o que o usuário escreveu em
 * markdown profissional SEM mudar o conteúdo. Funções puras — o handler cuida
 * do provider de IA e da escolha de modelo.
 */

/**
 * Monta o prompt pt-BR que pede a reformatação do texto. O contexto muda o
 * formato de saída: 'description' pode criar seções de descrição de card;
 * 'comment' fica curto, em formato de comentário.
 */
export function buildPolishPrompt(text: string, context: 'description' | 'comment'): string {
  const alvo =
    context === 'description'
      ? 'a descrição de um card do Jira'
      : 'um comentário em um card do Jira'

  const formato =
    context === 'description'
      ? [
          'FORMATO (descrição de card):',
          '- Estruture como uma descrição de card: pode criar seções com "###" quando o texto tiver assuntos distintos.',
          '- Use listas ("- ") para enumerações e checklists ("- [ ]") para itens que são tarefas ou critérios a verificar.',
          '- Use "**negrito**" para destacar rótulos e termos-chave.'
        ]
      : [
          'FORMATO (comentário):',
          '- Mantenha curto, no formato de um comentário — sem títulos grandes.',
          '- NÃO use "###" nem qualquer nível de título; no máximo "**negrito**" e listas ("- ", "- [ ]").',
          '- Prefira um ou dois parágrafos curtos, com lista apenas se o texto enumerar itens.'
        ]

  return [
    `Você revisa e formata textos de trabalho. Reformate o texto abaixo, que é ${alvo}, deixando-o profissional em markdown.`,
    '',
    'O QUE FAZER:',
    '- Corrija pontuação, ortografia, acentuação e concordância.',
    '- Estruture o texto com títulos ("###"), listas ("- "), checklists ("- [ ]") e negrito ("**") ONDE FIZER SENTIDO — não force estrutura em texto que já é uma frase simples.',
    '- Deixe o tom profissional e direto, sem enrolação.',
    '',
    'REGRAS INVIOLÁVEIS:',
    '- NÃO invente fatos nem adicione conteúdo que não esteja no texto original.',
    '- NÃO remova informação: tudo o que está no texto deve continuar no resultado.',
    '- Mantenha keys de tickets (ex.: BT-123) e URLs exatamente como estão, sem alterar nem reescrever.',
    '- Mantenha o idioma original do texto (se está em inglês, responda em inglês).',
    '- Responda SOMENTE com o markdown final, sem preâmbulo, sem comentários seus e sem cerca de código.',
    '',
    ...formato,
    '',
    '=== TEXTO ORIGINAL ===',
    text
  ].join('\n')
}

/**
 * Limpeza mínima da resposta: trim e remoção de UMA cerca de código envolvente
 * (``` ou ```lang na primeira linha e ``` na última), quando o modelo insiste
 * em embrulhar o markdown.
 */
export function cleanPolishedText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) return trimmed
  const lines = trimmed.split('\n')
  if (lines.length < 2) return trimmed
  return lines.slice(1, -1).join('\n').trim()
}
