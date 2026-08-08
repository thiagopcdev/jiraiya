export const t = {
  app: {
    name: 'Jiraiya',
    updateAvailable: (version: string) => `v${version} disponível`
  },
  nav: {
    dashboard: 'Hoje',
    board: 'Quadro',
    epics: 'Épicos',
    ask: 'Perguntar',
    filters: 'Filtros',
    create: 'Criar task',
    split: 'Dividir task',
    timeline: 'Timeline',
    mentions: 'Menções',
    summaries: 'Resumos',
    team: 'Time',
    alerts: 'Alertas',
    settings: 'Configurações',
    /** pares agrupados: apontam para a 1ª rota e mostram a 2ª como aba na tela */
    createSplit: 'Criar · Dividir',
    filtersTimeline: 'Filtros · Timeline',
    groupEntries: 'Entradas',
    groupTools: 'Ferramentas'
  },
  density: {
    label: 'Densidade',
    comfortable: 'confortável',
    compact: 'denso'
  },
  today: {
    title: 'Hoje',
    /** linha de contexto do cabeçalho: "quinta, 2 de agosto · Sprint 47 · 4 em andamento" */
    context: (date: string, sprint: string | null, inProgress: number) =>
      [date, sprint, `${inProgress} ${inProgress === 1 ? 'card seu' : 'cards seus'} em andamento`]
        .filter(Boolean)
        .join(' · '),
    dailyReady: 'Daily pronta',
    periodToday: 'Hoje',
    period7d: '7 dias',
    periodSprint: 'Sprint',
    sprintNone: 'Sem sprint ativa',
    sprintEnded: 'encerrada',
    sprintEndsToday: 'termina hoje',
    sprintEndsIn: (days: number) => `termina em ${days} dia${days === 1 ? '' : 's'}`,
    statInSprint: 'na sprint',
    statDone: 'concluídas',
    statOpen: 'abertas',
    statPointsLeft: 'sp restantes',
    attentionRejected: 'Reprovados',
    attentionStalled: 'Parados',
    attentionNoEstimate: 'Sem estimativa',
    allClear: 'Nada exigindo atenção',
    inProgressTitle: 'Em andamento',
    sortMostStalled: 'ordenar: mais parado',
    startTimer: 'iniciar',
    noStoryPoints: 'sem sp',
    todoInSprint: 'A fazer nesta sprint',
    footerTotal: (count: number, points: number) =>
      `${count} card${count === 1 ? '' : 's'} · ${points} sp`,
    openInBoard: 'abrir no quadro',
    activityTitle: 'Sua atividade',
    chipAll: 'Tudo',
    chipDone: 'Concluí',
    chipMoved: 'Movi',
    chipCommented: 'Comentei',
    activityEmpty: 'Nada registrado no período.',
    whereTimeGoes: 'Onde seu tempo passa',
    whereTimeGoesHint: (cards: number, days: number) =>
      `média por status dos seus últimos ${cards} cards concluídos (${days} dias)`,
    emptyInProgress: 'Nada em andamento atribuído a você.'
  },
  sync: {
    syncNow: 'Sincronizar',
    syncing: 'Sincronizando…',
    lastSync: (ago: string) => `Sincronizado ${ago}`,
    never: 'Nunca sincronizado',
    phases: {
      issues: 'Buscando issues…',
      reconcile: 'Conferindo cards excluídos…',
      activities: 'Processando atividades…',
      sprints: 'Atualizando sprints…'
    } as Record<string, string>,
    error: 'Falha na sincronização'
  },
  onboarding: {
    title: 'Conectar ao Jira',
    subtitle: 'Conecte sua conta do Jira Cloud para começar.',
    siteUrl: 'URL do site',
    siteUrlPlaceholder: 'suaempresa.atlassian.net',
    email: 'E-mail',
    apiToken: 'API token',
    tokenHelp: 'Crie um token em',
    tokenLinkLabel: 'id.atlassian.com/manage-profile/security/api-tokens',
    testAndConnect: 'Testar e conectar',
    connecting: 'Conectando…',
    connected: (name: string) => `Conectado como ${name}`,
    selectProjects: 'Selecione os projetos',
    selectProjectsSubtitle: 'Escolha os projetos que o Jiraiya vai acompanhar.',
    loadingProjects: 'Carregando projetos…',
    continue: 'Continuar',
    back: 'Voltar',
    initialSync: 'Sincronização inicial',
    initialSyncSubtitle: 'Baixando issues e atividades recentes. Isso pode levar alguns minutos.',
    start: 'Começar a usar',
    syncDone: 'Tudo pronto!',
    noProjects: 'Nenhum projeto encontrado.',
    selectAtLeastOne: 'Selecione pelo menos um projeto.'
  },
  common: {
    save: 'Salvar',
    cancel: 'Cancelar',
    copy: 'Copiar',
    copied: 'Copiado!',
    delete: 'Excluir',
    dismiss: 'Dispensar',
    loading: 'Carregando…',
    empty: 'Nada por aqui.',
    error: 'Algo deu errado',
    retry: 'Tentar novamente'
  },
  authInvalid: 'Credenciais do Jira expiraram — reconecte em Configurações.',
  create: {
    project: 'Projeto',
    issueType: 'Tipo',
    loadingIssueTypes: 'Carregando tipos…',
    noIssueTypes: 'Não é possível criar issues neste projeto por aqui.',
    ideaLabel: 'Descreva a ideia da task',
    ideaPlaceholder:
      'Ex.: contexto (onde/por que isso importa), o que precisa ser feito e o comportamento esperado ao final.',
    generating: 'Gerando…',
    aiUnavailableHint: (provider: string | null) =>
      provider
        ? `${provider} indisponível — verifique em Ajustes`
        : 'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)',
    summary: 'Título',
    description: 'Descrição',
    descriptionHint:
      'Use ###, **negrito**, - listas e - [ ] checklists — o Jiraiya converte para o formato do Jira.',
    assignToMe: 'Atribuir a mim',
    addToActiveSprint: (sprintName: string) => `Adicionar à sprint ativa — ${sprintName}`,
    storyPoints: 'Story points',
    submitting: 'Criando…',
    createdTitle: (key: string) => `Task ${key} criada`,
    createdHint: 'Ela aparece no app após a sincronização (alguns segundos).',
    openInJira: 'Abrir no Jira',
    createAnother: 'Criar outra'
  },
  split: {
    selectLabel: 'Meus cards abertos',
    selectPlaceholder: 'Selecione um card',
    orManualKey: 'ou informe a key',
    manualKeyPlaceholder: 'Ex.: BT-123',
    search: 'Buscar',
    searching: 'Buscando…',
    notFound: 'Card não encontrado localmente — verifique a key ou sincronize.',
    noDescription: 'Este card não tem descrição — a análise será baseada só no título.',
    analyze: (provider: string | null) => `Analisar com ${provider ?? 'IA'}`,
    analyzing: 'Analisando… pode levar alguns minutos',
    aiUnavailableHint: (provider: string | null) =>
      provider
        ? `${provider} indisponível — verifique em Ajustes`
        : 'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)',
    itemTitleLabel: 'Título',
    itemDescriptionLabel: 'Descrição',
    removeItem: 'Remover item',
    addItem: '+ Adicionar item',
    feedbackLabel: 'Feedback para a IA',
    feedbackPlaceholder: 'Ex.: junte os itens 2 e 3; adicione um item de testes e2e',
    refine: (provider: string | null) => `Refinar com ${provider ?? 'IA'}`,
    noSubtaskType: 'Este projeto não tem tipo de subtarefa',
    issueType: 'Tipo',
    assignToMe: 'Atribuir a mim',
    submit: (n: number) => `Criar ${n} card${n === 1 ? '' : 's'} no Jira`,
    submitting: 'Criando…',
    createdTitle: (n: number, parentKey: string) =>
      `${n} card${n === 1 ? '' : 's'} criado${n === 1 ? '' : 's'} a partir de ${parentKey}`,
    commentFailedHint: 'Os cards foram criados, mas o comentário no card original falhou.',
    openParentInJira: 'Ver card original',
    splitAnother: 'Dividir outro'
  },
  ask: {
    title: 'Perguntar ao Jiraiya',
    hint: 'Responde com base nos seus dados locais (janela de backfill)',
    placeholder: 'Pergunte algo sobre seus cards, sprint ou time…',
    emptyTitle: 'Pergunte qualquer coisa sobre o seu Jira — ou comece por uma sugestão:',
    send: 'Enviar',
    thinking: 'Pensando… (pode levar alguns minutos)',
    clearConversation: 'Limpar conversa',
    aiUnavailableHint: (provider: string | null) =>
      provider
        ? `${provider} indisponível — verifique em Ajustes`
        : 'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)',
    suggestions: [
      'O que travou a sprint essa semana?',
      'Resume o feedback que recebi nos meus cards',
      'Quais cards estão parados e por quê?'
    ] as string[]
  },
  filters: {
    savedTitle: 'Salvos',
    noSavedFilters: 'Nenhum filtro salvo ainda.',
    nameLabel: 'Nome',
    namePlaceholder: 'Ex.: Bugs críticos abertos',
    jqlLabel: 'JQL',
    jqlPlaceholder: 'Ex.: project = BT AND status != Done ORDER BY priority DESC',
    jqlExamplesHint:
      'Exemplos: assignee = currentUser() AND resolution = Unresolved · project = BT AND priority = Highest ORDER BY updated DESC',
    run: 'Executar',
    running: 'Executando…',
    save: 'Salvar',
    saving: 'Salvando…',
    editTitle: 'Editar filtro',
    edit: 'Editar',
    delete: 'Excluir',
    deleteConfirm: 'Excluir?',
    yes: 'Sim',
    no: 'Não',
    resultsCount: (n: number) => `${n} resultado${n === 1 ? '' : 's'}`,
    truncatedHint: 'Mostrando os primeiros 50.',
    empty: 'Nenhum resultado.',
    runToSeeResults: 'Execute o JQL para ver os resultados.'
  },
  board: {
    title: 'Quadro',
    boardLabel: 'Board',
    boardPlaceholder: 'Selecione um board',
    sprintLabel: 'Sprint',
    sprintPlaceholder: 'Selecione uma sprint',
    sprintFallbackName: (jiraId: number) => `Sprint ${jiraId}`,
    activeSuffix: ' (ativa)',
    closedSuffix: ' (encerrada)',
    readOnlyBadge: 'Sprint encerrada — somente leitura',
    noActiveSprint: 'Sem sprint ativa',
    outOfBoard: 'Fora do quadro',
    noAssignee: 'Sem responsável',
    all: 'Todos',
    you: 'você',
    fallbackBanner: 'Colunas aproximadas (configuração do board indisponível)',
    empty: 'Nenhum card nesta coluna.',
    backlogBadge: 'Backlog',
    backlogHint:
      'Coluna de backlog do kanban — no Jira ela não aparece no quadro: o conteúdo fica na tela "Backlog"',
    /** linha de contexto do ScreenHeader: "Bitcap · Sprint 47 (ativa) · 24 cards · 46 sp restantes" */
    context: (board: string, sprint: string | null, cards: number, pointsLeft: number) =>
      [board, sprint, `${cards} card${cards === 1 ? '' : 's'}`, `${pointsLeft} sp restantes`]
        .filter(Boolean)
        .join(' · '),
    wipLimit: (current: number, limit: number) => `${current}/${limit}`,
    columnSummary: (count: number, points: number) => `${count}·${points}sp`
  },
  detail: {
    openInJira: 'Abrir no Jira',
    share: 'Copiar link do card',
    shareCopied: 'Link copiado!',
    close: 'Fechar',
    notSynced: 'Este card não está aqui: ainda não sincronizou ou não existe mais no Jira.',
    storyPoints: (n: number) => `${n} pts`,
    description: 'Descrição',
    showAll: 'mostrar tudo',
    timeInStatus: 'Tempo por status',
    cardTimeline: 'Timeline do card',
    noActivity: 'Nenhuma atividade registrada.',
    noComments: 'Nenhum comentário ainda.',
    commentsOfflineHint: 'Sem conexão com o Jira — mostrando versão local em texto simples.',
    commentTitle: 'Comentar',
    commentPlaceholder: 'Escreva um comentário para postar no Jira…',
    commentSubmit: 'Comentar no Jira',
    commentSending: 'Enviando…',
    aiStructure: 'Estruturar com IA',
    aiNotesPlaceholder: 'Notas rápidas — a IA estrutura em um comentário.',
    aiGenerate: 'Gerar comentário',
    aiGenerating: 'Gerando…',
    aiUnavailableHint: (provider: string | null) =>
      provider
        ? `${provider} indisponível — verifique em Ajustes`
        : 'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)',
    editTitle: 'Editar',
    save: 'Salvar',
    saving: 'Salvando…',
    nothingChanged: 'Nada para salvar',
    storyPointsLabel: 'Story points',
    priorityLabel: 'Prioridade',
    severityPlaceholder: '—',
    originalEstimateLabel: 'Estimativa original',
    originalEstimatePlaceholder: '2d 4h',
    timeSpentRegistered: (value: string | null) => `Registrado: ${value ?? '—'}`,
    timeSpentPlaceholder: '1h 30m',
    timeSpentHint: 'Formato: 1w 2d 3h 30m',
    logWork: 'Registrar',
    logging: 'Registrando…',
    backLabel: 'Voltar',
    moveTo: 'Mover para…',
    moving: 'Movendo…',
    moved: 'Movido!',
    relatedTitle: 'Relacionados',
    parentLabel: 'Pai',
    subtasksTitle: (n: number) => `Subtarefas (${n})`,
    linksTitle: 'Vinculados',
    linksOffline: 'Sem conexão com o Jira para listar vínculos.',
    assigneeLabel: 'Responsável',
    reporterLabel: 'Relator',
    reporter: (name: string) => `Relator: ${name}`,
    unassigned: 'Sem responsável',
    meSuffix: ' (eu)',
    attachmentsTitle: 'Anexos',
    addSubtask: '+ Subtarefa',
    subtaskTitlePlaceholder: 'Título da subtarefa…',
    subtaskCreate: 'Criar',
    subtaskCreating: 'Criando…',
    editComment: 'Editar comentário',
    deleteComment: 'Excluir comentário',
    deleteConfirm: 'Excluir?',
    yes: 'Sim',
    no: 'Não',
    commentEditHint: 'salvar substitui a formatação original pela do editor (###, **, listas)',
    /** abas do painel docado / da gaveta */
    tabComments: 'Comentários',
    tabHistory: 'Histórico',
    tabWorklogs: 'Worklogs',
    tabPrs: 'PRs',
    resizeHandle: 'Redimensionar painel'
  },
  palette: {
    placeholder: 'Buscar card por key, título ou texto…',
    emptyHint: 'Busque por título, descrição ou comentários…',
    minChars: 'Digite ao menos 2 caracteres para buscar.',
    noResults: 'Nada encontrado.',
    hintOpen: '↵ abrir · ⌘↵ abrir no Jira',
    actionHint:
      'ações: mover KEY status · atribuir KEY nome|mim · apontar 1h30m KEY · comentar KEY texto',
    actionUsage: {
      mover: { syntax: 'mover KEY status', example: 'ex.: mover BT-806 review' },
      atribuir: { syntax: 'atribuir KEY nome ou mim', example: 'ex.: atribuir BT-806 mim' },
      apontar: {
        syntax: 'apontar tempo KEY comentário (opcional)',
        example: 'ex.: apontar 1h30m BT-806 revisão de código'
      },
      comentar: { syntax: 'comentar KEY texto', example: 'ex.: comentar BT-806 subiu para homolog' }
    } as Record<string, { syntax: string; example: string }>,
    actionMove: 'Mover',
    actionAssign: 'Atribuir',
    actionAssignMe: 'Atribuir a mim',
    actionWorklog: 'Apontar',
    actionComment: 'Comentar em',
    actionRun: '↵ executar',
    actionDone: 'Feito!',
    actionQueued: 'Sem rede — ação enfileirada.',
    actionNoMatch: 'Nenhum status compatível.',
    actionNoUser: 'Pessoa não encontrada.',
    actionLoading: 'Executando…'
  },
  changelog: {
    empty: 'Sem alterações registradas.',
    error: 'Não foi possível carregar o histórico (sem conexão?).',
    cleared: '(vazio)'
  },
  queue: {
    title: 'Ações pendentes',
    badgeTitle: 'ações aguardando sincronização',
    empty: 'Nada aguardando sincronização.',
    pendingOnIssue: 'Aguardando sincronização',
    statusPending: 'pendente',
    statusInflight: 'enviando…',
    statusFailed: 'falhou',
    retry: 'Tentar agora',
    retryAll: 'Tentar todas',
    discard: 'Descartar',
    discardConfirm: 'Descartar esta ação?',
    queuedToast: 'Sem rede — a ação ficou na fila e será enviada quando a conexão voltar.',
    failedNotice: 'Uma ação da fila falhou e foi revertida. Veja em Ações pendentes.'
  },
  drafts: {
    restored: 'Rascunho recuperado',
    discard: 'Descartar rascunho'
  }
}
