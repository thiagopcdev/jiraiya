import { z } from 'zod'
import { runClaudePrompt } from '../summaries/claude'

/**
 * Padrão de cards da Biud embutido no prompt (derivado da skill biud-jira-card).
 * Se o padrão do time mudar, atualizar aqui e na skill.
 */
const CARD_PATTERN = {
  titulo: [
    'TÍTULO:',
    '- Frase curta, específica e acionável, SEM ponto final, no máximo ~100 caracteres.',
    '- Prefixo de área entre colchetes quando a ideia indicar onde o trabalho acontece:',
    '  [FRONTEND], [BACKEND], [BACKOFFICE], [INFRA], [DADOS], [Automação], [Segurança] (ou combinações).',
    '  Sem área clara → sem prefixo.'
  ].join('\n'),
  historia: [
    'DESCRIÇÃO (História):',
    'A descrição deve seguir exatamente esta estrutura, nesta ordem:',
    '',
    '1. User story em EXATAMENTE 3 linhas, SEM título de seção antes:',
    '   Como <papel/persona>',
    '   Quero <capacidade>',
    '   Para que <benefício observável>',
    '',
    '2. Seção "### 🎯 Critérios de Aceite" com cenários em Gherkin. Cada cenário:',
    '   **Cenário N: <nome curto>** (numa linha própria)',
    '   Dado que <estado>, quando <ação>, então <resultado observável>. (na linha seguinte)',
    '   Um comportamento por cenário; cobrir caminho feliz, estado alternativo e erro/não encontrado.',
    '',
    '3. Seção "### ✅ Checklist de Ready (DoR)" com exatamente estes 4 itens (como "- [ ]"):',
    '   - [ ] Escrita no formato padrão (Quem, O quê, Por quê)?',
    '   - [ ] Critérios de aceite claros e testáveis em Gherkin?',
    '   - [ ] Prioridade definida pelo PO?',
    '   - [ ] Anexos/protótipos disponíveis?',
    '',
    '4. Seção "### 🏁 Checklist de Done (DoD)" com itens específicos da entrega (verificáveis,',
    '   espelhando os critérios de aceite) seguidos por estes 3 itens fixos (todos como "- [ ]"):',
    '   - [ ] Código revisado (Code Review).',
    '   - [ ] Testado em ambiente de Homologação (HMG).',
    '   - [ ] Sem erros de console ou logs desnecessários.'
  ].join('\n'),
  tarefa: [
    'DESCRIÇÃO (Tarefa/Bug):',
    'A descrição deve seguir esta estrutura, nesta ordem:',
    '',
    '1. Seção "### Contexto": por que isso existe, o que acontece hoje, cards relacionados (BT-XXX).',
    '   Em bug: o sintoma observado e onde (env, usuários afetados).',
    '',
    '2. (SÓ em bug com causa já investigada) Seção "### Problemas encontrados":',
    '   **1. <problema>** seguido da explicação com evidência. Separar sintoma (Contexto) de causa-raiz.',
    '',
    '3. Seção "### Solução proposta": o que fazer, objetivamente.',
    '',
    '4. Seção "### Critérios de Aceite" com cenários em Gherkin. Cada cenário:',
    '   **Cenário N: <nome curto>** (numa linha própria)',
    '   Dado que <estado>, quando <ação>, então <resultado observável>. (na linha seguinte)',
    '',
    '5. Seção "### DoD" com itens específicos da entrega seguidos por estes 3 itens fixos',
    '   (todos como "- [ ]"):',
    '   - [ ] Código revisado (Code Review).',
    '   - [ ] Testado em ambiente de Homologação (HMG).',
    '   - [ ] Sem erros de console ou logs desnecessários.'
  ].join('\n')
}

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
}): Promise<{ title: string; description: string }> {
  const isStory = /hist[oó]r|story/i.test(input.issueType)
  const bloco = isStory ? CARD_PATTERN.historia : CARD_PATTERN.tarefa

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

  const raw = await runClaudePrompt(prompt)
  return parseDraftResponse(raw)
}
