export const t = {
  app: {
    name: 'Jiraiya'
  },
  nav: {
    dashboard: 'Dashboard',
    timeline: 'Timeline',
    summaries: 'Resumos',
    alerts: 'Alertas',
    settings: 'Configurações'
  },
  sync: {
    syncNow: 'Sincronizar',
    syncing: 'Sincronizando…',
    lastSync: (ago: string) => `Sincronizado ${ago}`,
    never: 'Nunca sincronizado',
    phases: {
      issues: 'Buscando issues…',
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
    export: 'Exportar .md',
    delete: 'Excluir',
    dismiss: 'Dispensar',
    loading: 'Carregando…',
    empty: 'Nada por aqui.',
    error: 'Algo deu errado',
    retry: 'Tentar novamente'
  },
  authInvalid: 'Credenciais do Jira expiraram — reconecte em Configurações.'
}
