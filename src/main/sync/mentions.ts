import { adfToText, collectMentionAccountIds } from '../jira/adf'
import type { JiraComment } from '../jira/types'

const EXCERPT_MAX = 280

export interface MentionInsert {
  issueKey: string
  sourceId: string
  authorAccountId: string | null
  authorName: string | null
  excerpt: string | null
  occurredAt: string
}

/**
 * Extrai uma menção por comentário cujo ADF marca o `myAccountId`.
 * Auto-menções (autor == eu) entram aqui; o filtro de notificação é depois.
 */
export function extractMentions(input: {
  issueKey: string
  comments: JiraComment[]
  myAccountId: string
}): MentionInsert[] {
  const out: MentionInsert[] = []
  for (const comment of input.comments) {
    const mentioned = collectMentionAccountIds(comment.body)
    if (!mentioned.includes(input.myAccountId)) continue
    out.push({
      issueKey: input.issueKey,
      sourceId: `comment:${comment.id}`,
      authorAccountId: comment.author?.accountId ?? null,
      authorName: comment.author?.displayName ?? null,
      excerpt: truncate(adfToText(comment.body)),
      occurredAt: new Date(comment.created).toISOString()
    })
  }
  return out
}

function truncate(text: string): string | null {
  if (text.length === 0) return null
  if (text.length <= EXCERPT_MAX) return text
  return text.slice(0, EXCERPT_MAX) + '…'
}
