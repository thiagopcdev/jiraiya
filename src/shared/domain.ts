/** DTOs trafegados entre main e renderer via IPC. Sem APIs de Node aqui. */

export interface Workspace {
  id: number
  siteUrl: string
  email: string
  accountId: string
  displayName: string | null
  timeZone: string | null
}

export interface Project {
  jiraId: string
  key: string
  name: string
  avatarUrl: string | null
  selected: boolean
}

export interface Board {
  jiraId: number
  name: string | null
  type: string | null
  projectKey: string | null
}

export type SprintState = 'future' | 'active' | 'closed'

export interface Sprint {
  jiraId: number
  boardJiraId: number | null
  name: string | null
  state: SprintState | null
  startDate: string | null
  endDate: string | null
}

/** Tipo de issue criável num projeto (descoberto via createmeta). */
export interface CreateIssueType {
  id: string
  name: string
  subtask: boolean
}

export type StatusCategory = 'new' | 'indeterminate' | 'done'

export interface Issue {
  jiraId: string
  key: string
  projectKey: string
  summary: string
  descriptionText: string | null
  issueType: string | null
  status: string | null
  statusCategory: StatusCategory | null
  priority: string | null
  assigneeAccountId: string | null
  assigneeName: string | null
  reporterAccountId: string | null
  storyPoints: number | null
  sprintJiraId: number | null
  labels: string[]
  parentKey: string | null
  flagged: boolean
  createdAt: string | null
  updatedAt: string | null
  resolvedAt: string | null
  url: string
}

export type ActivityKind =
  | 'created'
  | 'status_change'
  | 'resolved'
  | 'assignment'
  | 'comment'
  | 'sprint_change'
  | 'priority_change'
  | 'estimate_change'

export interface IssueActivity {
  id: number
  issueKey: string
  issueSummary?: string
  issueStatus?: string | null
  kind: ActivityKind
  actorAccountId: string | null
  actorName: string | null
  field: string | null
  fromValue: string | null
  toValue: string | null
  bodyText: string | null
  occurredAt: string
}

export type SummaryTemplate = 'standup' | 'weekly' | 'one_on_one' | 'monthly'

export interface Summary {
  id: number
  periodType: string
  periodStart: string
  periodEnd: string
  template: SummaryTemplate
  contentMd: string
  generatedBy: 'template' | 'claude'
  createdAt: string
  editedAt: string | null
}

/** Menção ao usuário do workspace num comentário do Jira. */
export interface Mention {
  id: number
  issueKey: string
  issueSummary: string | null
  authorAccountId: string | null
  authorName: string | null
  excerpt: string | null
  occurredAt: string
  readAt: string | null
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface Alert {
  id: number
  ruleId: string
  issueKey: string | null
  severity: AlertSeverity
  message: string
  firstDetectedAt: string
  lastSeenAt: string
}

export interface SyncStatus {
  running: boolean
  lastSuccessAt: string | null
  lastError: string | null
  progress: { phase: string; done: number; total: number | null } | null
}

/** Radar de um membro do time no período (não é placar de produtividade). */
export interface TeamMemberSummary {
  accountId: string
  name: string
  isMe: boolean
  /** atribuídas à pessoa, em andamento agora */
  inProgress: Issue[]
  /** concluídas pela pessoa no período */
  done: Issue[]
  /** em andamento sem atividade há N dias */
  stalled: Array<Issue & { stalledDays: number }>
  /** contagem de mudanças de status feitas pela pessoa no período */
  movedCount: number
  /** contagem de comentários feitos pela pessoa no período */
  commentedCount: number
}

/**
 * Entregas de uma sprint: story points com resolved_at dentro da janela
 * temporal da sprint (nunca por associação sprint_jira_id, que só guarda a
 * última sprint do card e é infiel para histórico).
 */
export interface VelocitySprint {
  sprintJiraId: number
  name: string | null
  state: 'active' | 'closed'
  startDate: string
  /** Fim efetivo da janela usada no cálculo (complete_date ?? end_date ?? agora). */
  endDate: string
  myPoints: number
  teamPoints: number
  myCount: number
  teamCount: number
}

export interface VelocitySummary {
  /** Da mais antiga para a mais nova. */
  sprints: VelocitySprint[]
  /** Totais deduplicados sobre a janela global (issue conta uma vez mesmo em sprints sobrepostas). */
  totals: { myPoints: number; teamPoints: number; myCount: number; teamCount: number }
}

/** Tempo médio (dias) que MEUS cards passam num status, na janela analisada. */
export interface LeadTimeStat {
  status: string
  avgDays: number
  samples: number
}

/** Sprint resumida para seleção (retro, filtros). */
export interface SprintListItem {
  jiraId: number
  name: string | null
  state: 'active' | 'closed'
  startDate: string
  endDate: string | null
}

/** Alias de modelo do CLI do Claude (resolvido pelo CLI para a versão mais nova). */
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus'

export interface Prefs {
  syncIntervalMinutes: number
  backfillDays: number
  stalledDays: number
  syncMode: 'project' | 'personal'
  notifyCriticalAlerts: boolean
  notifyAssignedToMe: boolean
  notifyMentions: boolean
  modelSummaries: ClaudeModel
  modelTeam: ClaudeModel
  modelDraft: ClaudeModel
  modelSplit: ClaudeModel
  modelComment: ClaudeModel
  modelAsk: ClaudeModel
  /** gera a daily de ontem no primeiro boot do dia e notifica */
  morningBriefing: boolean
  /** verifica novas releases no GitHub (repo privado exige token) */
  updateCheck: boolean
  /** PR↔card via CLI `gh` — opcional: exige gh instalado e autenticado; desligado por padrão */
  prIntegration: boolean
  /** escopo extra da busca de PRs (ex. 'org:biudtech'); vazio = busca global */
  prSearchScope: string
  theme: ThemePref
  /** lembra de registrar tempo em dias úteis quando nenhum worklog foi lançado no dia */
  worklogReminder: boolean
  /** horário local do lembrete, formato HH:MM */
  worklogReminderTime: string
}

/** Tendências por sprint fechada (janela temporal — sprint_jira_id não é confiável p/ histórico). */
export interface SprintTrend {
  jiraId: number
  name: string | null
  endDate: string | null
  /** SP entregues pelo TIME na janela da sprint */
  deliveredSp: number
  deliveredCount: number
  /** média em dias de (resolved_at - created_at) dos entregues; null sem amostras */
  avgLeadDays: number | null
  /** cards criados durante a janela (proxy de scope creep) */
  createdDuringCount: number
}

/** Tema visual do app; 'system' segue o modo claro/escuro do SO. */
export type ThemePref = 'dark' | 'light' | 'system'

/** Ação proposta pelo Perguntar — só executa com confirmação explícita do usuário. */
export interface AskAction {
  type: 'move_status' | 'assign_me' | 'comment' | 'log_work' | 'set_story_points'
  key: string
  /** move_status: nome do status de destino (resolvido para transição no executor) */
  statusName?: string
  /** comment */
  text?: string
  /** log_work (formato Jira: 1h 30m) */
  timeSpent?: string
  /** set_story_points */
  storyPoints?: number
}

/** Tipos de ação que a fila offline sabe reenviar. */
export type PendingActionType = 'comment' | 'transition' | 'worklog' | 'update'

/** Visão de uma ação enfileirada (fila offline) para o renderer. */
export interface PendingAction {
  id: number
  issueKey: string
  type: PendingActionType
  /** resumo humano da ação (ex.: 'Mover para Em andamento', 'Comentar: "…"') */
  summary: string
  status: 'pending' | 'inflight' | 'failed'
  attempts: number
  lastError: string | null
  createdAt: string
}

/** Entrada do histórico (changelog) de um card. */
export interface ChangelogEntry {
  id: string
  authorName: string | null
  createdAt: string
  items: Array<{ field: string; from: string | null; to: string | null }>
}

export const DEFAULT_PREFS: Prefs = {
  syncIntervalMinutes: 15,
  backfillDays: 30,
  stalledDays: 3,
  syncMode: 'project',
  notifyCriticalAlerts: false,
  notifyAssignedToMe: true,
  notifyMentions: true,
  modelSummaries: 'sonnet',
  modelTeam: 'sonnet',
  modelDraft: 'sonnet',
  // divisão é a tarefa mais pesada de raciocínio — vale o modelo mais forte
  modelSplit: 'opus',
  modelComment: 'sonnet',
  // perguntas abertas sobre os dados pedem o modelo mais capaz
  modelAsk: 'opus',
  morningBriefing: true,
  updateCheck: true,
  prIntegration: false,
  prSearchScope: '',
  theme: 'dark',
  worklogReminder: true,
  worklogReminderTime: '17:30'
}
