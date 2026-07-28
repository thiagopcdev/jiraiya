import { runAiPrompt } from './service'

/**
 * Prompts das funções que reescrevem texto (resumos e panorama do time).
 * Só o texto do prompt vive aqui — provider e modelo são resolvidos pelo
 * service. Falha lança AiUnavailableError e o chamador cai no template
 * determinístico.
 */

/** Reescreve o markdown do template com IA, usando o JSON de fatos como fonte. */
export function enhanceSummary(input: {
  templateMarkdown: string
  digestJson: string
}): Promise<string> {
  const prompt = [
    'Você recebe um resumo de trabalho gerado automaticamente a partir de dados do Jira, mais o JSON com os fatos brutos.',
    'Reescreva o resumo em português do Brasil, com tom profissional e conciso, bom para colar numa daily/weekly.',
    'Regras: não invente fatos; mantenha as chaves dos tickets (ex.: BT-123) exatamente como estão; mantenha a estrutura de seções em markdown; agrupe itens relacionados quando fizer sentido; corte redundância.',
    'Se o JSON tiver "comentariosDoPeriodo", use-os para enriquecer os itens com contexto real (decisões tomadas, bloqueios, feedback de QA/PO, próximos passos) — resuma com suas palavras, sem transcrever comentários longos nem citar autores desnecessariamente.',
    'Na seção "Hoje pretendo" liste APENAS itens acionáveis pelo autor (campo paraHoje do JSON); cards em teste/deploy/review/homologação estão com terceiros e pertencem a "Aguardando" ou "Bloqueios" — nunca a "Hoje pretendo".',
    'Responda SOMENTE com o markdown final, sem preâmbulo.',
    '',
    '=== RESUMO (template) ===',
    input.templateMarkdown,
    '',
    '=== FATOS (JSON) ===',
    input.digestJson
  ].join('\n')
  return runAiPrompt('summaries', prompt)
}

/**
 * Panorama do time em uma única chamada (todos os membros de uma vez — evita N
 * chamadas caras). Foco em colaboração/awareness, não em ranking.
 */
export function summarizeTeam(input: { periodLabel: string; teamJson: string }): Promise<string> {
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
  return runAiPrompt('team', prompt)
}
