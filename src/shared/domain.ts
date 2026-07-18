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

export interface Prefs {
  syncIntervalMinutes: number
  backfillDays: number
  stalledDays: number
  syncMode: 'project' | 'personal'
  notifyCriticalAlerts: boolean
  notifyAssignedToMe: boolean
  notifyMentions: boolean
}

export const DEFAULT_PREFS: Prefs = {
  syncIntervalMinutes: 15,
  backfillDays: 30,
  stalledDays: 3,
  syncMode: 'project',
  notifyCriticalAlerts: false,
  notifyAssignedToMe: true,
  notifyMentions: true
}
