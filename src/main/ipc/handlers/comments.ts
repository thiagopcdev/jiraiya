import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { getIssueByKey } from '../../db/repos/issue'
import { adfToText, textToAdf } from '../../jira/adf'
import { JiraHttpError } from '../../jira/http'
import { claudeStatus, ClaudeUnavailableError } from '../../summaries/claude'
import { draftCommentWithClaude } from '../../issues/commentDraft'
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

export function registerCommentHandlers(ctx: AppContext): void {
  handle('issues:description', async ({ key }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const description = (await client.issueDescription(key.trim().toUpperCase())) as unknown
    return { description }
  })

  handle('issues:comments', async ({ key }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const raw = await client.issueComments(key.trim().toUpperCase())
    // mais recente primeiro, com o ADF cru para o renderer formatar
    const comments = raw
      .map((c) => ({
        id: c.id,
        authorAccountId: c.author?.accountId ?? null,
        authorName: c.author?.displayName ?? null,
        createdAt: c.created,
        body: (c.body ?? null) as unknown,
        bodyText: adfToText(c.body ?? null)
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return { comments }
  })

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

  handle('issues:commentUpdate', async ({ issueKey, commentId, body }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey.trim().toUpperCase())
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    try {
      await client.updateComment(issue.key, commentId, textToAdf(body))
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('COMMENT_FAILED', 'O Jira recusou a edição: ' + parseCreateError(err))
      }
      throw err
    }
    return { ok: true as const }
  })

  handle('issues:commentDelete', async ({ issueKey, commentId }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issue = getIssueByKey(ctx.db, workspace.id, issueKey.trim().toUpperCase())
    if (!issue) {
      throw new AppError(
        'NOT_FOUND',
        'Card não encontrado localmente — sincronize ou confira a key'
      )
    }
    try {
      await client.deleteComment(issue.key, commentId)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError('COMMENT_FAILED', 'O Jira recusou a exclusão: ' + parseCreateError(err))
      }
      throw err
    }
    return { ok: true as const }
  })
}
