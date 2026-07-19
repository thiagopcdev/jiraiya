import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { getIssueByKey } from '../../db/repos/issue'
import { textToAdf } from '../../jira/adf'
import { claudeStatus, ClaudeUnavailableError } from '../../summaries/claude'
import { draftCommentWithClaude } from '../../issues/commentDraft'

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

export function registerCommentHandlers(ctx: AppContext): void {
  handle('issues:commentDraft', async ({ issueKey, notes }) => {
    const workspace = requireWorkspace(ctx)
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey.trim().toUpperCase())
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    if (!claudeStatus().available) {
      throw new AppError(
        'CLAUDE_UNAVAILABLE',
        'CLI do Claude não encontrado — instale o Claude Code para gerar rascunhos'
      )
    }
    try {
      const body = await draftCommentWithClaude({
        issueKey: issue.key,
        issueSummary: issue.summary,
        notes,
        model: getPrefs(ctx.db).modelComment
      })
      return { body, generatedBy: 'claude' as const }
    } catch (err) {
      const message =
        err instanceof ClaudeUnavailableError || err instanceof Error
          ? err.message
          : 'Não foi possível gerar o rascunho com o Claude'
      throw new AppError('CLAUDE_UNAVAILABLE', message)
    }
  })

  handle('issues:comment', async ({ issueKey, body }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey.trim().toUpperCase())
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    await client.addComment(issue.key, textToAdf(body))
    return { ok: true as const }
  })
}
