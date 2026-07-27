import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { drainQueue } from '../../queue/drainer'
import { revertAction } from '../../queue/perform'
import {
  listActions,
  queueCounts,
  removeAction,
  toPendingAction,
  type PendingActionRow
} from '../../queue/repo'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function getRow(ctx: AppContext, workspaceId: number, id: number): PendingActionRow | null {
  return (
    (ctx.db
      .prepare('SELECT * FROM pending_action WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as PendingActionRow | undefined) ?? null
  )
}

export function registerQueueHandlers(ctx: AppContext): void {
  handle('queue:list', () => {
    const workspace = requireWorkspace(ctx)
    return { actions: listActions(ctx.db, workspace.id).map(toPendingAction) }
  })

  handle('queue:retry', async ({ id }) => {
    const workspace = requireWorkspace(ctx)

    if (id === undefined) {
      // todas as falhas voltam para a fila (attempts preservado como histórico)
      ctx.db
        .prepare(
          `UPDATE pending_action SET status = 'pending', last_error = NULL
           WHERE workspace_id = ? AND status = 'failed'`
        )
        .run(workspace.id)
    } else {
      const row = getRow(ctx, workspace.id, id)
      if (!row) throw new AppError('NOT_FOUND', 'Ação não está mais na fila')
      if (row.status === 'failed') {
        ctx.db
          .prepare(`UPDATE pending_action SET status = 'pending', last_error = NULL WHERE id = ?`)
          .run(row.id)
      }
    }

    ctx.push('push:queue-changed', queueCounts(ctx.db, workspace.id))
    await drainQueue(ctx)
    return { ok: true as const }
  })

  handle('queue:discard', ({ id }) => {
    const workspace = requireWorkspace(ctx)
    const row = getRow(ctx, workspace.id, id)
    if (!row) throw new AppError('NOT_FOUND', 'Ação não está mais na fila')

    // ação que falhou de vez já foi revertida pelo drain — só desfaz o que
    // ainda está pendente com efeito otimista aplicado
    if (row.status !== 'failed') revertAction(ctx, workspace.id, row)
    removeAction(ctx.db, row.id)
    ctx.push('push:queue-changed', queueCounts(ctx.db, workspace.id))
    return { ok: true as const }
  })
}
