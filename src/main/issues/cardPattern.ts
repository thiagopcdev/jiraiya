/**
 * Padrão de cards da Biud embutido nos prompts de geração (Criar task e
 * Dividir task), derivado da skill biud-jira-card.
 * Se o padrão do time mudar, atualizar aqui e na skill.
 */
export const CARD_PATTERN = {
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

/** Bloco de descrição adequado ao tipo de issue (História vs Tarefa/Bug). */
export function patternBlockFor(issueType: string | null): string {
  return issueType && /hist[oó]r|story/i.test(issueType)
    ? CARD_PATTERN.historia
    : CARD_PATTERN.tarefa
}
