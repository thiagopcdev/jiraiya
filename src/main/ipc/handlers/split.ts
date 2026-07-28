import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getIssueByKey } from '../../db/repos/issue'
import { textToAdf } from '../../jira/adf'
import { markdownToAdf } from '../../issues/markdownToAdf'
import { JiraHttpError } from '../../jira/http'
import { activeProvider } from '../../ai/service'
import { splitIssue } from '../../issues/split'
import { parseCreateError } from './create'

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

export function registerSplitHandlers(ctx: AppContext): void {
  handle('issues:splitDraft', async ({ parentKey, feedback, currentItems }) => {
    const workspace = requireWorkspace(ctx)
    const row = getIssueByKey(ctx.db, workspace.id, parentKey.trim().toUpperCase())
    if (!row) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    const provider = activeProvider()
    if (!provider) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'Nenhum provider de IA disponível — configure em Ajustes'
      )
    }
    try {
      const { items, rationale } = await splitIssue({
        parentKey: row.key,
        parentTitle: row.summary,
        parentDescription: row.description_text,
        parentIssueType: row.issue_type,
        feedback,
        currentItems
      })
      return { items, rationale, generatedBy: provider.id }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Não foi possível gerar o rascunho (${provider.label})`
      throw new AppError('AI_UNAVAILABLE', message)
    }
  })

  handle('issues:split', async ({ parentKey, mode, issueTypeId, items, assignToMe }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const parent = getIssueByKey(ctx.db, workspace.id, parentKey.trim().toUpperCase())
    if (!parent) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }

    const keys: string[] = []
    for (const [i, item] of items.entries()) {
      const fields: Record<string, unknown> = {
        project: { key: parent.project_key },
        issuetype: { id: issueTypeId },
        summary: item.title
      }
      if (mode === 'subtask') fields.parent = { key: parent.key }
      if (item.description.trim()) fields.description = markdownToAdf(item.description)
      if (assignToMe) fields.assignee = { id: workspace.account_id }
      try {
        keys.push((await client.createIssue(fields)).key)
      } catch (err) {
        const detail =
          err instanceof JiraHttpError && err.status === 400
            ? parseCreateError(err)
            : err instanceof Error
              ? err.message
              : 'erro desconhecido'
        throw new AppError(
          'JIRA_SPLIT',
          `Falha no item ${i + 1} ("${item.title}"): ${detail}. ` +
            (keys.length
              ? `Já criados no Jira: ${keys.join(', ')} — remova-os da lista antes de tentar de novo.`
              : 'Nenhum card foi criado.')
        )
      }
    }

    let commentPosted = true
    try {
      await client.addComment(
        parent.key,
        textToAdf(`Card dividido via Jiraiya em: ${keys.join(', ')}`)
      )
    } catch {
      commentPosted = false
    }
    return { keys, commentPosted }
  })
}
