import { z } from 'zod'
import type {
  Alert,
  Mention,
  Board,
  CreateIssueType,
  Issue,
  IssueActivity,
  LeadTimeStat,
  Prefs,
  Project,
  Sprint,
  SprintListItem,
  StatusCategory,
  Summary,
  SummaryTemplate,
  SyncStatus,
  TeamMemberSummary,
  VelocitySummary,
  Workspace
} from './domain'

/** Fonte única de verdade dos canais IPC: schema zod do request + tipo do response. */

const claudeModelSchema = z.enum(['haiku', 'sonnet', 'opus']).optional()

/** Item de divisão de card (título + descrição em texto simples). */
const splitItemSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(20000)
})

const periodSchema = z.object({
  type: z.enum(['today', 'yesterday', '7d', '30d', 'sprint', 'custom']),
  start: z.string().optional(),
  end: z.string().optional()
})

export const ipcContract = {
  'auth:connect': {
    req: z.object({
      siteUrl: z.string().min(1),
      email: z.string().email(),
      apiToken: z.string().min(1)
    }),
    res: undefined as unknown as { workspace: Workspace }
  },
  'auth:status': {
    req: z.object({}),
    res: undefined as unknown as { connected: boolean; workspace: Workspace | null }
  },
  'auth:disconnect': {
    req: z.object({}),
    res: undefined as unknown as { ok: true }
  },
  'projects:list': {
    req: z.object({ refresh: z.boolean().optional() }),
    res: undefined as unknown as { projects: Project[] }
  },
  'projects:setSelected': {
    req: z.object({ keys: z.array(z.string()) }),
    res: undefined as unknown as { ok: true }
  },
  'boards:list': {
    req: z.object({}),
    res: undefined as unknown as { boards: Board[] }
  },
  'sync:run': {
    req: z.object({ full: z.boolean().optional() }),
    res: undefined as unknown as { started: boolean }
  },
  'sync:status': {
    req: z.object({}),
    res: undefined as unknown as SyncStatus
  },
  'issues:query': {
    req: z.object({
      period: periodSchema,
      bucket: z
        .enum([
          'moved',
          'commented',
          'done',
          'inProgress',
          'stalled',
          'rejected',
          'sprintScope',
          'mine',
          'all'
        ])
        .optional()
    }),
    res: undefined as unknown as { issues: Issue[] }
  },
  'activity:timeline': {
    req: z.object({
      period: periodSchema,
      onlyMine: z.boolean().optional(),
      projectKey: z.string().optional()
    }),
    res: undefined as unknown as { activities: IssueActivity[] }
  },
  'summaries:generate': {
    req: z.object({
      period: periodSchema,
      template: z.enum(['standup', 'weekly', 'one_on_one', 'monthly']),
      useClaude: z.boolean()
    }),
    res: undefined as unknown as { markdown: string; generatedBy: 'template' | 'claude' }
  },
  'summaries:save': {
    req: z.object({
      period: periodSchema,
      template: z.enum(['standup', 'weekly', 'one_on_one', 'monthly']),
      contentMd: z.string(),
      generatedBy: z.enum(['template', 'claude'])
    }),
    res: undefined as unknown as { id: number }
  },
  'summaries:list': {
    req: z.object({}),
    res: undefined as unknown as { summaries: Summary[] }
  },
  'summaries:delete': {
    req: z.object({ id: z.number() }),
    res: undefined as unknown as { ok: true }
  },
  'claude:status': {
    req: z.object({}),
    res: undefined as unknown as { available: boolean; path: string | null }
  },
  'export:clipboard': {
    req: z.object({ text: z.string() }),
    res: undefined as unknown as { ok: true }
  },
  'export:file': {
    req: z.object({ content: z.string(), suggestedName: z.string() }),
    res: undefined as unknown as { saved: boolean; path: string | null }
  },
  'alerts:list': {
    req: z.object({}),
    res: undefined as unknown as { alerts: Alert[] }
  },
  'alerts:dismiss': {
    req: z.object({ id: z.number() }),
    res: undefined as unknown as { ok: true }
  },
  'prefs:get': {
    req: z.object({}),
    res: undefined as unknown as Prefs
  },
  'prefs:set': {
    req: z.object({
      syncIntervalMinutes: z.number().int().min(5).max(120).optional(),
      backfillDays: z.number().int().min(7).max(180).optional(),
      stalledDays: z.number().int().min(1).max(30).optional(),
      syncMode: z.enum(['project', 'personal']).optional(),
      notifyCriticalAlerts: z.boolean().optional(),
      notifyAssignedToMe: z.boolean().optional(),
      notifyMentions: z.boolean().optional(),
      modelSummaries: claudeModelSchema,
      modelTeam: claudeModelSchema,
      modelDraft: claudeModelSchema,
      modelSplit: claudeModelSchema,
      modelComment: claudeModelSchema,
      modelAsk: claudeModelSchema,
      morningBriefing: z.boolean().optional(),
      updateCheck: z.boolean().optional(),
      prIntegration: z.boolean().optional(),
      prSearchScope: z.string().trim().max(200).optional()
    }),
    res: undefined as unknown as Prefs
  },
  'ask:question': {
    req: z.object({
      question: z.string().trim().min(1).max(2000),
      /** trocas anteriores para follow-ups (mais antiga primeiro) */
      history: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string().max(8000)
          })
        )
        .max(12)
        .optional()
    }),
    res: undefined as unknown as { answer: string; generatedBy: 'claude' }
  },
  'filters:list': {
    req: z.object({}),
    res: undefined as unknown as {
      filters: Array<{ id: number; name: string; jql: string; position: number }>
    }
  },
  'filters:save': {
    req: z.object({
      id: z.number().int().optional(),
      name: z.string().trim().min(1).max(80),
      jql: z.string().trim().min(1).max(2000)
    }),
    res: undefined as unknown as { id: number }
  },
  'filters:delete': {
    req: z.object({ id: z.number().int() }),
    res: undefined as unknown as { ok: true }
  },
  'filters:run': {
    req: z.object({
      jql: z.string().trim().min(1).max(2000),
      limit: z.number().int().min(1).max(100).optional()
    }),
    res: undefined as unknown as { issues: Issue[]; truncated: boolean }
  },
  'sprint:risk': {
    req: z.object({}),
    res: undefined as unknown as {
      sprint: { jiraId: number; name: string } | null
      items: Array<{ issue: Issue; signals: string[]; score: number }>
    }
  },
  'sprint:riskExplain': {
    req: z.object({}),
    res: undefined as unknown as { markdown: string; generatedBy: 'claude' }
  },
  'update:check': {
    req: z.object({ force: z.boolean().optional() }),
    res: undefined as unknown as {
      current: string
      latest: string | null
      url: string | null
      available: boolean
      tokenConfigured: boolean
      error: string | null
    }
  },
  'update:setToken': {
    req: z.object({ token: z.string().trim().min(1).nullable() }),
    res: undefined as unknown as { ok: true }
  },
  'briefing:today': {
    req: z.object({}),
    res: undefined as unknown as { summaryId: number | null }
  },
  'shell:openIssue': {
    req: z.object({ issueKey: z.string() }),
    res: undefined as unknown as { ok: true }
  },
  'team:summary': {
    req: z.object({ period: periodSchema }),
    res: undefined as unknown as {
      members: TeamMemberSummary[]
      periodLabel: string
      syncMode: 'project' | 'personal'
    }
  },
  'team:velocity': {
    req: z.object({ sprintCount: z.number().int().min(3).max(20).optional() }),
    res: undefined as unknown as VelocitySummary
  },
  'team:narrative': {
    req: z.object({ period: periodSchema }),
    res: undefined as unknown as { ok: boolean; markdown: string }
  },
  'sprint:active': {
    req: z.object({}),
    res: undefined as unknown as { sprint: Sprint | null }
  },
  'app:info': {
    req: z.object({}),
    res: undefined as unknown as { version: string }
  },
  'issueTypes:list': {
    req: z.object({ projectKey: z.string().min(1), includeSubtasks: z.boolean().optional() }),
    res: undefined as unknown as { issueTypes: CreateIssueType[] }
  },
  'issues:get': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as { issue: Issue | null }
  },
  'issues:activity': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as { activities: IssueActivity[] }
  },
  'issues:search': {
    req: z.object({
      query: z.string().trim().min(2).max(100),
      limit: z.number().int().min(1).max(50).optional()
    }),
    res: undefined as unknown as { issues: Issue[] }
  },
  'issues:attachments': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      attachments: Array<{
        id: string
        filename: string
        mimeType: string | null
        size: number
        isImage: boolean
      }>
    }
  },
  'issues:attachmentData': {
    req: z.object({
      attachmentId: z.string().min(1),
      variant: z.enum(['thumbnail', 'full'])
    }),
    res: undefined as unknown as {
      /** data URI base64; null quando tooLarge (usar salvar/abrir) */
      dataUri: string | null
      mimeType: string | null
      tooLarge: boolean
    }
  },
  'issues:attachmentSave': {
    req: z.object({ attachmentId: z.string().min(1), filename: z.string().min(1) }),
    res: undefined as unknown as { saved: boolean; path: string | null }
  },
  'issues:attachmentOpen': {
    req: z.object({ attachmentId: z.string().min(1), filename: z.string().min(1) }),
    res: undefined as unknown as { ok: true }
  },
  'app:tempFiles': {
    req: z.object({}),
    res: undefined as unknown as { bytes: number }
  },
  'app:tempClear': {
    req: z.object({}),
    res: undefined as unknown as { ok: true; freedBytes: number }
  },
  'issues:commentUpdate': {
    req: z.object({
      issueKey: z.string().trim().min(1).max(64),
      commentId: z.string().min(1),
      body: z.string().trim().min(1).max(10000)
    }),
    res: undefined as unknown as { ok: true }
  },
  'issues:commentDelete': {
    req: z.object({
      issueKey: z.string().trim().min(1).max(64),
      commentId: z.string().min(1)
    }),
    res: undefined as unknown as { ok: true }
  },
  'issues:transitions': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      transitions: Array<{
        id: string
        name: string
        toStatusName: string
        toCategoryKey: StatusCategory
      }>
    }
  },
  'issues:transition': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      transitionId: z.string().min(1)
    }),
    res: undefined as unknown as { newStatus: string; newStatusCategory: StatusCategory }
  },
  'issues:assignable': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as { users: Array<{ accountId: string; displayName: string }> }
  },
  'issues:children': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as { issues: Issue[] }
  },
  'issues:links': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      links: Array<{
        label: string
        key: string
        summary: string | null
        status: string | null
        statusCategory: StatusCategory | null
      }>
    }
  },
  'issues:editMeta': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      storyPointsEditable: boolean
      priority: {
        editable: boolean
        current: string | null
        options: Array<{ id: string; name: string }>
      }
      /** campo custom de severidade descoberto por nome no editmeta; null se o card não o tem */
      severity: {
        fieldId: string
        name: string
        current: string | null
        options: Array<{ id: string; value: string }>
      } | null
      /** tempo total já registrado (formato Jira, ex. '3h 30m') */
      timeSpent: string | null
      originalEstimate: string | null
      /** campo 'Controle de tempo' presente na tela de edição (permite editar a estimativa original) */
      timeTrackingEditable: boolean
    }
  },
  'issues:update': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      /** null limpa o campo */
      storyPoints: z.number().min(0).nullable().optional(),
      priorityId: z.string().min(1).optional(),
      /** nome exibido, para atualizar o cache local sem novo fetch */
      priorityName: z.string().min(1).optional(),
      severity: z.object({ fieldId: z.string().min(1), optionId: z.string().min(1) }).optional(),
      /** Estimativa original (formato Jira: 1w 2d 3h 30m) */
      originalEstimate: z
        .string()
        .trim()
        .regex(/^(\d+[wdhm])(\s+\d+[wdhm])*$/i, 'Formato: 1w 2d 3h 30m')
        .optional(),
      /** null = remover responsável */
      assigneeAccountId: z.string().min(1).nullable().optional(),
      /** nome exibido, para atualizar o cache local sem novo fetch */
      assigneeName: z.string().min(1).nullable().optional()
    }),
    res: undefined as unknown as { ok: true }
  },
  'issues:logWork': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      /** formato Jira: combinações de Nw Nd Nh Nm (ex. '1h 30m') */
      timeSpent: z
        .string()
        .trim()
        .regex(/^(\d+[wdhm])(\s+\d+[wdhm])*$/i, 'Formato: 1w 2d 3h 30m'),
      comment: z.string().max(2000).optional()
    }),
    res: undefined as unknown as { ok: true; totalTimeSpent: string | null }
  },
  'issues:description': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      /** documento ADF cru da descrição (null se vazia) */
      description: unknown | null
    }
  },
  'issues:comments': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      /** body é o documento ADF cru (renderizado com formatação no renderer) */
      comments: Array<{
        id: string
        authorAccountId: string | null
        authorName: string | null
        createdAt: string
        body: unknown
        /** texto plano do body (para o editor de comentário próprio) */
        bodyText: string
      }>
    }
  },
  'issues:comment': {
    req: z.object({
      issueKey: z.string().trim().min(1).max(64),
      body: z.string().trim().min(1).max(10000)
    }),
    res: undefined as unknown as { ok: true }
  },
  'issues:commentDraft': {
    req: z.object({
      issueKey: z.string().trim().min(1).max(64),
      notes: z.string().trim().min(1).max(4000)
    }),
    res: undefined as unknown as { body: string; generatedBy: 'claude' }
  },
  'board:view': {
    req: z.object({
      boardJiraId: z.number().int().optional(),
      sprintJiraId: z.number().int().optional()
    }),
    res: undefined as unknown as {
      board: Board
      boards: Board[]
      /** sprint exibida (ativa ou a escolhida no seletor) */
      sprint: { jiraId: number; name: string } | null
      /** opções do seletor: ativa + fechadas recentes (só boards scrum) */
      sprints: SprintListItem[]
      /** sprint encerrada → drag & drop desabilitado */
      readOnly: boolean
      columns: Array<{
        name: string
        statusIds: string[]
        statusNames: string[]
        issues: Issue[]
      }>
      /** cards do escopo cujo status não está em nenhuma coluna */
      unmapped: Issue[]
      /** 'fallback' = config do board indisponível, colunas derivadas por categoria */
      columnsSource: 'jira' | 'fallback'
    }
  },
  'board:move': {
    req: z.object({
      issueKey: z.string().trim().min(1).max(64),
      targetStatusIds: z.array(z.string()).min(1),
      targetColumnName: z.string().min(1)
    }),
    res: undefined as unknown as { newStatus: string; newStatusCategory: StatusCategory }
  },
  'sprint:list': {
    req: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    res: undefined as unknown as { sprints: SprintListItem[] }
  },
  'summaries:sprintRetro': {
    req: z.object({ sprintJiraId: z.number().int(), useClaude: z.boolean() }),
    res: undefined as unknown as { markdown: string; generatedBy: 'template' | 'claude' }
  },
  'stats:leadTime': {
    req: z.object({ days: z.number().int().min(7).max(365).optional() }),
    res: undefined as unknown as {
      statuses: LeadTimeStat[]
      cardCount: number
      windowDays: number
    }
  },
  'issues:splitDraft': {
    req: z.object({
      parentKey: z.string().trim().min(1).max(64),
      feedback: z.string().max(4000).optional(),
      currentItems: z.array(splitItemSchema).max(10).optional()
    }),
    res: undefined as unknown as {
      items: Array<{ title: string; description: string }>
      rationale: string
      generatedBy: 'claude'
    }
  },
  'issues:split': {
    req: z.object({
      parentKey: z.string().trim().min(1).max(64),
      mode: z.enum(['subtask', 'sibling']),
      issueTypeId: z.string().min(1),
      items: z.array(splitItemSchema).min(1).max(10),
      assignToMe: z.boolean().optional()
    }),
    res: undefined as unknown as { keys: string[]; commentPosted: boolean }
  },
  'issues:draft': {
    req: z.object({
      idea: z.string().min(1).max(4000),
      projectKey: z.string().min(1),
      issueType: z.string().min(1)
    }),
    res: undefined as unknown as { title: string; description: string; generatedBy: 'claude' }
  },
  'issues:create': {
    req: z.object({
      projectKey: z.string().min(1),
      issueTypeId: z.string().min(1),
      summary: z.string().min(1).max(255),
      description: z.string(),
      assignToMe: z.boolean().optional(),
      addToActiveSprint: z.boolean().optional(),
      storyPoints: z.number().positive().optional(),
      /** cria como subtarefa deste card (issueTypeId deve ser um tipo subtask) */
      parentKey: z.string().trim().min(1).max(64).optional()
    }),
    res: undefined as unknown as { key: string }
  },
  'issues:updateText': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      summary: z.string().trim().min(1).max(500).optional(),
      /** markdown simples; convertido para ADF no main (markdownToAdf) */
      descriptionMarkdown: z.string().max(50000).optional()
    }),
    res: undefined as unknown as { ok: true }
  },
  'sprint:moveTargets': {
    req: z.object({}),
    res: undefined as unknown as {
      sprints: Array<{ jiraId: number; name: string | null; state: 'active' | 'future' }>
    }
  },
  'sprint:moveIssue': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      /** 'backlog' ou o jiraId da sprint de destino */
      target: z.union([z.literal('backlog'), z.number().int()])
    }),
    res: undefined as unknown as { ok: true }
  },
  'worklog:list': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      worklogs: Array<{
        id: string
        authorName: string | null
        authorAccountId: string | null
        /** autor == conta conectada (permite editar/apagar) */
        isMine: boolean
        started: string
        timeSpent: string
        timeSpentSeconds: number
        comment: string | null
      }>
      totalTimeSpent: string | null
    }
  },
  'worklog:update': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      worklogId: z.string().min(1),
      timeSpent: z
        .string()
        .trim()
        .regex(/^(\d+[wdhm])(\s+\d+[wdhm])*$/i, 'Formato: 1w 2d 3h 30m'),
      comment: z.string().max(2000).optional()
    }),
    res: undefined as unknown as { ok: true; totalTimeSpent: string | null }
  },
  'worklog:delete': {
    req: z.object({
      key: z.string().trim().min(1).max(64),
      worklogId: z.string().min(1)
    }),
    res: undefined as unknown as { ok: true; totalTimeSpent: string | null }
  },
  'search:global': {
    req: z.object({
      query: z.string().trim().min(2).max(200),
      limit: z.number().int().min(1).max(50).optional()
    }),
    res: undefined as unknown as {
      results: Array<{
        key: string
        summary: string
        status: string | null
        statusCategory: StatusCategory | null
        url: string
        /** trecho com o termo destacado entre 「 e 」 (snippet do FTS) */
        snippet: string | null
        match: 'title' | 'description' | 'comment'
      }>
    }
  },
  'epics:overview': {
    req: z.object({}),
    res: undefined as unknown as {
      epics: Array<{
        key: string
        summary: string
        status: string | null
        statusCategory: StatusCategory | null
        url: string
        total: number
        done: number
        spTotal: number
        spDone: number
      }>
    }
  },
  'issues:linkTypes': {
    req: z.object({}),
    res: undefined as unknown as {
      types: Array<{ id: string; name: string; inward: string; outward: string }>
    }
  },
  'issues:linkCreate': {
    req: z.object({
      fromKey: z.string().trim().min(1).max(64),
      toKey: z.string().trim().min(1).max(64),
      typeName: z.string().min(1),
      /** outward: fromKey é o lado outward (ex. 'blocks'); inward: fromKey é o lado inward (ex. 'is blocked by') */
      direction: z.enum(['outward', 'inward'])
    }),
    res: undefined as unknown as { ok: true }
  },
  'prs:status': {
    req: z.object({}),
    res: undefined as unknown as { ghAvailable: boolean; enabled: boolean }
  },
  'prs:forIssue': {
    req: z.object({ key: z.string().trim().min(1).max(64) }),
    res: undefined as unknown as {
      /** false quando a integração está desligada ou o gh não está disponível */
      available: boolean
      prs: Array<{
        repo: string
        number: number
        title: string
        url: string
        state: 'open' | 'closed' | 'merged'
        isDraft: boolean
        reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
        checks: 'passing' | 'failing' | 'pending' | null
        updatedAt: string
      }>
    }
  },
  'mentions:list': {
    req: z.object({}),
    res: undefined as unknown as { mentions: Mention[]; unreadCount: number }
  },
  'mentions:markAllRead': {
    req: z.object({}),
    res: undefined as unknown as { ok: true }
  }
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = z.infer<IpcContract[C]['req']>
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/** Envelope de resposta: handlers nunca vazam stack trace pro renderer. */
export type IpcResult<C extends IpcChannel> =
  { ok: true; data: IpcResponse<C> } | { ok: false; code: string; message: string }

/** Canais push main -> renderer */
export interface PushEvents {
  'push:sync-progress': { phase: string; done: number; total: number | null }
  'push:sync-complete': { success: boolean; error: string | null }
  'push:alerts-updated': { count: number }
  'push:mentions-updated': { unreadCount: number }
  'push:auth-invalid': Record<string, never>
  'push:update-available': { version: string; url: string }
  'push:briefing-ready': { summaryId: number }
}
export type PushChannel = keyof PushEvents

export const PUSH_CHANNELS: PushChannel[] = [
  'push:sync-progress',
  'push:sync-complete',
  'push:alerts-updated',
  'push:mentions-updated',
  'push:auth-invalid',
  'push:update-available',
  'push:briefing-ready'
]

/** Superfície exposta no preload como window.api */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResult<C>>
  on<P extends PushChannel>(channel: P, cb: (payload: PushEvents[P]) => void): () => void
}

export type SummaryTemplateName = SummaryTemplate
