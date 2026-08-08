import type { AiFeature } from '@shared/domain'

/**
 * Índice da busca de Configurações, fora do componente para não cair na regra
 * de fast-refresh (arquivo de componente só exporta componente) e para poder
 * ser lido pelo teste que garante que todo cartão declarado aqui existe mesmo
 * na tela.
 */

export type GroupId =
  | 'account'
  | 'sync'
  | 'notifications'
  | 'appearance'
  | 'ai'
  | 'prs'
  | 'templates'
  | 'data'
  | 'updates'

/** Funcionalidades com modelo configurável, na ordem mostrada em Configurações. */
export const AI_FEATURES: Array<{ key: AiFeature; label: string }> = [
  { key: 'summaries', label: 'Resumos (daily/weekly/1:1)' },
  { key: 'team', label: 'Narrativa do time' },
  { key: 'draft', label: 'Criar task (rascunho)' },
  { key: 'split', label: 'Dividir task (análise)' },
  { key: 'comment', label: 'Comentário de card (IA)' },
  { key: 'ask', label: 'Perguntar ao Jiraiya' }
]

/**
 * Índice da busca. Só ele sabe em qual grupo mora cada cartão, então serve para
 * (a) saltar para o grupo do primeiro resultado, (b) esconder o cartão inteiro
 * quando nada nele casa e (c) avisar quando a busca não achou nada. As LINHAS se
 * filtram sozinhas pelo próprio rótulo — este índice não precisa listar controle
 * que não seja linha de configuração (chips, lista de templates, botões soltos).
 * Rótulo novo numa linha? Acrescente aqui, senão ele fica invisível para a busca.
 */
/**
 * Índice da busca. O casamento com o cartão é por igualdade do título
 * (`SEARCH_INDEX.find((e) => e.card === title)`), então renomear um título aqui
 * ou lá tiraria o cartão da busca em silêncio — o teste "todo cartão do índice
 * existe na tela" existe justamente para transformar isso em falha.
 */
export const SEARCH_INDEX: Array<{ group: GroupId; card: string; labels: string[] }> = [
  { group: 'account', card: 'Conta', labels: ['Conta conectada'] },
  {
    group: 'sync',
    card: 'Ritmo de sincronização',
    labels: [
      'Intervalo de sincronização',
      'Janela de histórico',
      'Considerar ticket parado após',
      'Modo de sincronização'
    ]
  },
  { group: 'sync', card: 'Projetos acompanhados', labels: [] },
  {
    group: 'sync',
    card: 'Estado da sincronização',
    labels: [
      'Última sincronização',
      'Fila offline',
      'Registro de requisições',
      'Sincronização completa'
    ]
  },
  {
    group: 'notifications',
    card: 'Notificações',
    labels: [
      'Notificar quando um card for atribuído a mim',
      'Notificar quando eu for mencionado',
      'Notificar alertas críticos',
      'Gerar minha daily no primeiro uso do dia'
    ]
  },
  {
    group: 'notifications',
    card: 'Lembrete de tempo',
    labels: ['Lembrar de registrar tempo', 'Horário do lembrete']
  },
  { group: 'appearance', card: 'Aparência', labels: ['Tema', 'Densidade'] },
  {
    group: 'ai',
    card: 'Inteligência artificial',
    labels: ['Provider ativo', 'Chave da OpenRouter', ...AI_FEATURES.map((f) => f.label)]
  },
  {
    group: 'prs',
    card: 'Pull requests (GitHub)',
    labels: ['Mostrar PRs relacionados ao card', 'Escopo da busca']
  },
  { group: 'templates', card: 'Templates de comentário', labels: [] },
  { group: 'data', card: 'Backup', labels: ['Exportar backup', 'Importar backup'] },
  { group: 'data', card: 'Armazenamento', labels: ['Arquivos temporários de anexos'] },
  {
    group: 'updates',
    card: 'Atualizações',
    labels: ['Verificar novas versões automaticamente', 'Nova versão', 'Token do GitHub']
  }
]

/** Busca sem acento e sem caixa — "sincronizacao" tem que achar "Sincronização". */
export function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function cardMatches(entry: (typeof SEARCH_INDEX)[number], query: string): boolean {
  return (
    norm(entry.card).includes(query) || entry.labels.some((label) => norm(label).includes(query))
  )
}
