import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { CreateIssueType } from '@shared/domain'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint } from '../../db/repos/catalog'
import { markdownToAdf } from '../../issues/markdownToAdf'
import { JiraHttpError } from '../../jira/http'
import { activeProvider } from '../../ai/service'
import { AiUnavailableError } from '../../ai/types'
import { draftIssue } from '../../issues/draft'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function requireClient(ctx: AppContext): NonNullable<ReturnType<typeof ctx.getClient>> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return client
}

export function registerCreateHandlers(ctx: AppContext): void {
  handle('issueTypes:list', async ({ projectKey, includeSubtasks }) => {
    const client = requireClient(ctx)
    const raw = await client.listCreateIssueTypes(projectKey)
    const visible = includeSubtasks ? raw : raw.filter((t) => t.subtask !== true)
    const issueTypes: CreateIssueType[] = visible.map((t) => ({
      id: t.id,
      name: t.name,
      subtask: t.subtask === true
    }))
    return { issueTypes }
  })

  handle('issues:draft', async ({ idea, projectKey, issueType }) => {
    const provider = activeProvider()
    if (!provider) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'Nenhum provider de IA disponível — configure em Ajustes'
      )
    }
    try {
      const draft = await draftIssue({ idea, projectKey, issueType })
      return { ...draft, generatedBy: provider.id }
    } catch (err) {
      const message =
        err instanceof AiUnavailableError || err instanceof Error
          ? err.message
          : `Não foi possível gerar o rascunho (${provider.label})`
      throw new AppError('AI_UNAVAILABLE', message)
    }
  })

  handle(
    'issues:create',
    async ({
      projectKey,
      issueTypeId,
      summary,
      description,
      assignToMe,
      addToActiveSprint,
      storyPoints,
      parentKey
    }) => {
      const workspace = requireWorkspace(ctx)
      const client = requireClient(ctx)

      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        issuetype: { id: issueTypeId },
        summary
      }
      if (parentKey) fields.parent = { key: parentKey.trim().toUpperCase() }
      if (description.trim()) fields.description = markdownToAdf(description)
      if (assignToMe !== false) fields.assignee = { id: workspace.account_id }
      if (addToActiveSprint && workspace.sprint_field_id && workspace.sprint_field_id !== 'none') {
        const sprint = getActiveSprint(ctx.db, workspace.id)
        // No create, o campo Sprint aceita o id numérico da sprint ativa
        if (sprint) fields[workspace.sprint_field_id] = Number(sprint.jiraId)
      }
      if (storyPoints != null && workspace.story_points_field_id) {
        fields[workspace.story_points_field_id] = storyPoints
      }

      try {
        const created = await client.createIssue(fields)
        return { key: created.key }
      } catch (err) {
        if (err instanceof JiraHttpError && err.status === 400) {
          throw new AppError('JIRA_CREATE', 'O Jira recusou a criação: ' + parseCreateError(err))
        }
        throw err
      }
    }
  )
}

/** Extrai mensagens legíveis do corpo 400 do Jira; fallback genérico se não parsear. */
export function parseCreateError(err: JiraHttpError): string {
  try {
    const body = JSON.parse(err.body ?? '') as {
      errorMessages?: string[]
      errors?: Record<string, string>
    }
    const msgs = [
      ...(body.errorMessages ?? []),
      ...Object.entries(body.errors ?? {}).map(([field, msg]) => `${field}: ${msg}`)
    ]
    if (msgs.length > 0) return msgs.join('; ')
  } catch {
    // corpo não-JSON — cai no fallback
  }
  return `o Jira respondeu ${err.status}`
}
