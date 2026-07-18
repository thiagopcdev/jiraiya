import { z } from 'zod'
import type {
  Alert,
  Mention,
  Board,
  CreateIssueType,
  Issue,
  IssueActivity,
  Prefs,
  Project,
  Sprint,
  Summary,
  SummaryTemplate,
  SyncStatus,
  TeamMemberSummary,
  Workspace
} from './domain'

/** Fonte única de verdade dos canais IPC: schema zod do request + tipo do response. */

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
      notifyMentions: z.boolean().optional()
    }),
    res: undefined as unknown as Prefs
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
    req: z.object({ projectKey: z.string().min(1) }),
    res: undefined as unknown as { issueTypes: CreateIssueType[] }
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
      storyPoints: z.number().positive().optional()
    }),
    res: undefined as unknown as { key: string }
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
}
export type PushChannel = keyof PushEvents

export const PUSH_CHANNELS: PushChannel[] = [
  'push:sync-progress',
  'push:sync-complete',
  'push:alerts-updated',
  'push:mentions-updated',
  'push:auth-invalid'
]

/** Superfície exposta no preload como window.api */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResult<C>>
  on<P extends PushChannel>(channel: P, cb: (payload: PushEvents[P]) => void): () => void
}

export type SummaryTemplateName = SummaryTemplate
