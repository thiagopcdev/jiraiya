import { Notification } from 'electron'
import type { AppContext } from '../appContext'
import { getWorkspaceRow } from '../db/repos/workspace'
import { isRetryableNetworkError } from './classify'
import { isMaybeIssueGoneError, purgeIfIssueGone } from '../issues/gone'
import { performAction, revertAction } from './perform'
import {
  markFailed,
  markInflight,
  markPendingAgain,
  nextPendingByIssue,
  queueCounts,
  removeAction,
  toPendingAction,
  type PendingActionRow
} from './repo'

/** Evita dois drains concorrentes (sync agendado + retry manual, por exemplo). */
let draining = false

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'Erro inesperado'
}

/** Avisa o usuário que a ação foi descartada (falha definitiva). */
function notifyFailure(row: PendingActionRow, message: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: 'Jiraiya',
    body: `${row.issue_key}: "${toPendingAction(row).summary}" não pôde ser enviada — ${message}`
  })
  n.show()
}

/**
 * Envia as ações pendentes ao Jira, na ordem em que foram criadas dentro de cada
 * card. Erro de rede aborta o drain (segue offline, nada é perdido); erro
 * definitivo marca a ação como falha, desfaz o efeito otimista local, notifica e
 * pula para o próximo card.
 */
export async function drainQueue(ctx: AppContext): Promise<{ sent: number; failed: number }> {
  if (draining) return { sent: 0, failed: 0 }

  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace || !ctx.getClient()) return { sent: 0, failed: 0 }

  draining = true
  let sent = 0
  let failed = 0
  try {
    // ações que ficaram 'inflight' de um drain interrompido (app fechado no meio)
    // voltam para a fila — senão nenhum drain futuro as veria
    ctx.db
      .prepare(
        `UPDATE pending_action SET status = 'pending'
         WHERE workspace_id = ? AND status = 'inflight'`
      )
      .run(workspace.id)

    const grouped = nextPendingByIssue(ctx.db, workspace.id)
    for (const rows of grouped.values()) {
      let skipIssue = false
      for (const row of rows) {
        if (skipIssue) break
        markInflight(ctx.db, row.id)
        try {
          await performAction(ctx, workspace, row)
          removeAction(ctx.db, row.id)
          sent++
        } catch (err) {
          let message = errorMessage(err)
          if (isRetryableNetworkError(err)) {
            // ainda sem rede: devolve para a fila e para o drain por completo
            markPendingAgain(ctx.db, row.id, message)
            return { sent, failed }
          }
          // card excluído no Jira: a ação nunca vai passar — falha com mensagem
          // que explica o motivo e tira o card fantasma do cache
          if (isMaybeIssueGoneError(err)) {
            message = (await purgeIfIssueGone(ctx, workspace.id, row.issue_key)) ?? message
          }
          markFailed(ctx.db, row.id, message)
          revertAction(ctx, workspace.id, row)
          notifyFailure(row, message)
          failed++
          // as demais ações deste card seguem pendentes — tenta no próximo drain
          skipIssue = true
        }
      }
    }
    return { sent, failed }
  } finally {
    draining = false
    ctx.push('push:queue-changed', queueCounts(ctx.db, workspace.id))
  }
}
