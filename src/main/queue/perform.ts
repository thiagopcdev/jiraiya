import type { AppContext } from '../appContext'
import type { getWorkspaceRow } from '../db/repos/workspace'
import type { PendingActionRow } from './repo'
import type { StatusCategory } from '@shared/domain'
import { AppError } from '../ipc/registry'
import { updateIssueFields, updateIssueStatus } from '../db/repos/issue'
import { textToAdf } from '../jira/adf'
import { markdownToAdf } from '../issues/markdownToAdf'

type WorkspaceRow = NonNullable<ReturnType<typeof getWorkspaceRow>>

/** Campos de `issues:update` (sem a key) — o que foi pedido pelo renderer. */
export interface QueuedUpdateFields {
  storyPoints?: number | null
  priorityId?: string
  priorityName?: string | null
  severity?: { fieldId: string; optionId: string }
  originalEstimate?: string
  assigneeAccountId?: string | null
  assigneeName?: string | null
}

interface CommentPayload {
  summary: string
  /** markdown cru; a conversão para ADF acontece só no envio */
  body: string
}

interface TransitionPayload {
  summary: string
  transitionId: string
  toStatusName: string
  toCategoryKey: StatusCategory
  revert: { status: string | null; category: StatusCategory | null }
}

interface WorklogPayload {
  summary: string
  timeSpent: string
  comment: string | null
}

interface UpdatePayload {
  summary: string
  fields: QueuedUpdateFields
  revert: QueuedUpdateFields
}

/** Id do campo de story points, ou null se não configurado ('none' = desativado). */
export function storyPointsFieldIdOf(workspace: WorkspaceRow): string | null {
  const id = workspace.story_points_field_id
  return id && id !== 'none' ? id : null
}

/** Monta o corpo `fields` do PUT de edição a partir dos campos pedidos. */
export function buildJiraUpdateFields(
  input: QueuedUpdateFields,
  spFieldId: string | null
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  if (input.storyPoints !== undefined && spFieldId) fields[spFieldId] = input.storyPoints
  if (input.priorityId) fields.priority = { id: input.priorityId }
  if (input.severity) fields[input.severity.fieldId] = { id: input.severity.optionId }
  if (input.originalEstimate) fields.timetracking = { originalEstimate: input.originalEstimate }
  if (input.assigneeAccountId !== undefined) {
    fields.assignee = input.assigneeAccountId === null ? null : { id: input.assigneeAccountId }
  }
  return fields
}

function parsePayload<T>(row: PendingActionRow): T {
  try {
    return JSON.parse(row.payload) as T
  } catch {
    throw new AppError('QUEUE_PAYLOAD', 'Ação enfileirada com dados corrompidos')
  }
}

/** Envia a ação enfileirada para o Jira, replicando o caminho online do handler. */
export async function performAction(
  ctx: AppContext,
  workspace: WorkspaceRow,
  row: PendingActionRow
): Promise<void> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  const issueKey = row.issue_key

  switch (row.type) {
    case 'comment': {
      const payload = parsePayload<CommentPayload>(row)
      await client.addComment(issueKey, markdownToAdf(payload.body))
      return
    }
    case 'transition': {
      const payload = parsePayload<TransitionPayload>(row)
      const transitions = await client.issueTransitions(issueKey)
      // o workflow pode ter mudado desde o enfileiramento: tenta pelo id e,
      // como plano B, por um caminho que leve ao mesmo status de destino
      const picked =
        transitions.find((t) => t.id === payload.transitionId) ??
        transitions.find(
          (t) => t.toStatusName.toLowerCase() === (payload.toStatusName ?? '').toLowerCase()
        )
      if (!picked) {
        throw new AppError(
          'TRANSITION_CONFLICT',
          `Não há mais transição para "${payload.toStatusName}" em ${issueKey} — o card mudou de estado no Jira`
        )
      }
      await client.doTransition(issueKey, picked.id)
      return
    }
    case 'worklog': {
      const payload = parsePayload<WorklogPayload>(row)
      const comment = payload.comment?.trim()
      await client.addWorklog(issueKey, payload.timeSpent, comment ? textToAdf(comment) : undefined)
      return
    }
    case 'update': {
      const payload = parsePayload<UpdatePayload>(row)
      const fields = buildJiraUpdateFields(payload.fields, storyPointsFieldIdOf(workspace))
      if (Object.keys(fields).length === 0) return
      await client.updateIssue(issueKey, fields)
      return
    }
  }
}

/**
 * Desfaz o efeito otimista aplicado no cache local quando a ação foi enfileirada
 * (usado ao falhar de vez ou ao descartar). Comentário e apontamento não têm
 * efeito local — nada a desfazer.
 */
export function revertAction(ctx: AppContext, workspaceId: number, row: PendingActionRow): void {
  if (row.type === 'transition') {
    const payload = parsePayload<TransitionPayload>(row)
    const { status, category } = payload.revert ?? { status: null, category: null }
    if (status && category) {
      updateIssueStatus(ctx.db, workspaceId, row.issue_key, status, category)
    }
    return
  }
  if (row.type === 'update') {
    const payload = parsePayload<UpdatePayload>(row)
    const revert = payload.revert ?? {}
    const patch: {
      storyPoints?: number | null
      priority?: string
      assigneeAccountId?: string | null
      assigneeName?: string | null
    } = {}
    if (revert.storyPoints !== undefined) patch.storyPoints = revert.storyPoints
    if (revert.priorityName !== undefined && revert.priorityName !== null) {
      patch.priority = revert.priorityName
    }
    if (revert.assigneeAccountId !== undefined) patch.assigneeAccountId = revert.assigneeAccountId
    if (revert.assigneeName !== undefined) patch.assigneeName = revert.assigneeName
    updateIssueFields(ctx.db, workspaceId, row.issue_key, patch)
  }
}
