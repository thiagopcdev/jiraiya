/**
 * Cards excluídos no Jira.
 *
 * O sync é incremental (`updated >= cursor`), então um card apagado no Jira
 * simplesmente para de aparecer nas buscas: ele nunca era removido do cache
 * local e virava card fantasma — visível no quadro, com 404 em qualquer ação.
 *
 * Aqui fica a reação a esse 404: confirmar com o Jira que a issue realmente não
 * existe mais e, se for o caso, apagar o cache local e avisar o renderer.
 */

import type { AppContext } from '../appContext'
import { getIssueByKey, purgeIssue } from '../db/repos/issue'
import { getWorkspaceRow } from '../db/repos/workspace'
import { JiraAuthError, JiraHttpError } from '../jira/http'

/** Formato de key de issue (ex.: BT-907) — evita tratar texto solto como key. */
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/

/**
 * O erro PODE ser "issue não existe": 404 do Jira. Só um candidato — o mesmo 404
 * sai de sub-recursos (comentário/apontamento já apagado), por isso quem age
 * sobre isso precisa confirmar com `purgeIfIssueGone`.
 */
export function isMaybeIssueGoneError(err: unknown): boolean {
  return err instanceof JiraHttpError && !(err instanceof JiraAuthError) && err.status === 404
}

/** Key de issue no payload de um canal IPC (`key` ou `issueKey`), se houver. */
export function issueKeyFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as { key?: unknown; issueKey?: unknown }
  const raw = typeof p.issueKey === 'string' ? p.issueKey : typeof p.key === 'string' ? p.key : null
  if (raw === null) return null
  const key = raw.trim().toUpperCase()
  return ISSUE_KEY_RE.test(key) ? key : null
}

export function issueGoneMessage(key: string): string {
  return `${key} não existe mais no Jira (excluído ou sem acesso) — o card foi removido daqui`
}

/**
 * Confirma com o Jira se a issue sumiu e, nesse caso, apaga o cache local e
 * emite `push:issue-gone`. Devolve a mensagem para o usuário, ou null quando não
 * é o caso: card ainda existe, não estava em cache, ou não foi possível
 * confirmar (sem client/erro de rede na confirmação) — na dúvida não apaga nada.
 */
export async function purgeIfIssueGone(
  ctx: AppContext,
  workspaceId: number,
  key: string
): Promise<string | null> {
  if (!getIssueByKey(ctx.db, workspaceId, key)) return null

  const client = ctx.getClient()
  if (!client) return null
  try {
    if (await client.issueExists(key)) return null
  } catch {
    // não deu para confirmar (rede/5xx): mantém o cache e o erro original
    return null
  }

  purgeIssue(ctx.db, workspaceId, key)
  ctx.push('push:issue-gone', { key })
  return issueGoneMessage(key)
}

/**
 * Resolver instalado no registry IPC: recebe a key do payload do canal que
 * tomou 404 e devolve a mensagem se o card foi purgado.
 */
export function makeIssueGoneResolver(ctx: AppContext): (key: string) => Promise<string | null> {
  return async (key: string) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) return null
    return purgeIfIssueGone(ctx, workspace.id, key)
  }
}
