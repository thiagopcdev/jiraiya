import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { AdfNode } from '../../jira/types'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { getIssueByKey } from '../../db/repos/issue'
import { adfToText } from '../../jira/adf'
import { adfToMarkdown } from '../../jira/adfToMarkdown'
import { markdownToAdf } from '../../issues/markdownToAdf'
import { JiraHttpError } from '../../jira/http'
import { claudeStatus, ClaudeUnavailableError } from '../../summaries/claude'
import { draftCommentWithClaude } from '../../issues/commentDraft'
import { isRetryableNetworkError } from '../../queue/classify'
import { enqueueAction, queueCounts } from '../../queue/repo'
import { parseCreateError } from './create'

/** Trecho do comentário para o resumo da fila (uma linha, no máximo 60 chars). */
function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat
}

/**
 * ADF → markdown tolerante a falhas: documento vazio ou conversão que lance
 * (shape exótico) devolvem o fallback (null na descrição, texto plano no comentário).
 */
function safeMarkdown<T extends string | null>(node: AdfNode | null, fallback: T): string | T {
  if (!node) return fallback
  try {
    return adfToMarkdown(node)
  } catch {
    return fallback
  }
}

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
    const description = await client.issueDescription(key.trim().toUpperCase())
    return { description: description as unknown, markdown: safeMarkdown(description, null) }
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
        bodyText: adfToText(c.body ?? null),
        bodyMarkdown: safeMarkdown(c.body ?? null, adfToText(c.body ?? null))
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
    // conversão fora do try: falha aqui é markdown inválido, não falta de rede
    const adf = markdownToAdf(body)
    try {
      await client.addComment(issue.key, adf)
    } catch (err) {
      if (isRetryableNetworkError(err)) {
        // sem rede: guarda o markdown cru (convertido de novo no envio)
        enqueueAction(ctx.db, workspace.id, {
          issueKey: issue.key,
          type: 'comment',
          payload: { summary: `Comentar: "${excerpt(body)}"`, body }
        })
        ctx.push('push:queue-changed', queueCounts(ctx.db, workspace.id))
        return { ok: true as const, queued: true }
      }
      throw err
    }
    return { ok: true as const, queued: false }
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
      await client.updateComment(issue.key, commentId, markdownToAdf(body))
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
