import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw, X } from 'lucide-react'
import type { PendingAction } from '@shared/domain'
import { invoke } from '../api/client'
import { useQueue } from '../lib/queue'
import { Badge, Button, Spinner } from './ui'
import { t } from '../strings/ptBR'

/**
 * Crachá da fila offline — só aparece com ações pendentes/falhadas. Clique abre
 * o QueueCenter (modal por cima de tudo, via portal). Compacto e sem largura
 * própria: o rodapé da sidebar passou a mostrar o número no estado de sync, e
 * quem hospeda o crachá agora é a linha "Estado da sincronização" em
 * Configurações.
 */
export function QueueBadge(): React.JSX.Element | null {
  const { pendingCount, failedCount } = useQueue()
  const [open, setOpen] = useState(false)
  const total = pendingCount + failedCount

  if (total === 0) return null

  const Icon = failedCount > 0 ? CloudOff : RefreshCw
  return (
    <>
      <button
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-zinc-800 ${
          failedCount > 0
            ? 'text-red-400 light:text-red-600'
            : 'text-amber-400 light:text-amber-600'
        }`}
        title={t.queue.badgeTitle}
        onClick={() => setOpen(true)}
      >
        <Icon size={13} />
        <span>{total}</span>
      </button>
      {open && <QueueCenter onClose={() => setOpen(false)} />}
    </>
  )
}

function statusColor(status: PendingAction['status']): 'zinc' | 'blue' | 'red' {
  if (status === 'failed') return 'red'
  if (status === 'inflight') return 'blue'
  return 'zinc'
}

function QueueRow({
  action,
  busy,
  confirming,
  onRetry,
  onDiscardRequest,
  onDiscardCancel,
  onDiscardConfirm
}: {
  action: PendingAction
  busy: boolean
  confirming: boolean
  onRetry: () => void
  onDiscardRequest: () => void
  onDiscardCancel: () => void
  onDiscardConfirm: () => void
}): React.JSX.Element {
  const statusLabel =
    action.status === 'pending'
      ? t.queue.statusPending
      : action.status === 'inflight'
        ? t.queue.statusInflight
        : t.queue.statusFailed

  return (
    <div className="border-b border-zinc-800 px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-zinc-500">{action.issueKey}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{action.summary}</span>
        <Badge color={statusColor(action.status)}>{statusLabel}</Badge>
        {action.attempts > 1 && (
          <span className="shrink-0 text-xs text-zinc-500">×{action.attempts}</span>
        )}
      </div>
      {action.status === 'failed' && action.lastError && (
        <p
          className="mt-1 truncate text-xs text-red-400 light:text-red-600"
          title={action.lastError}
        >
          {action.lastError}
        </p>
      )}
      {action.status === 'failed' && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="secondary"
            className="!px-2 !py-1 text-xs"
            disabled={busy}
            onClick={onRetry}
          >
            {busy ? <Spinner /> : null}
            {t.queue.retry}
          </Button>
          {confirming ? (
            <>
              <span className="text-xs text-zinc-400">{t.queue.discardConfirm}</span>
              <Button
                variant="danger"
                className="!px-2 !py-1 text-xs"
                disabled={busy}
                onClick={onDiscardConfirm}
              >
                {t.detail.yes}
              </Button>
              <Button
                variant="ghost"
                className="!px-2 !py-1 text-xs"
                disabled={busy}
                onClick={onDiscardCancel}
              >
                {t.detail.no}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              className="!px-2 !py-1 text-xs"
              disabled={busy}
              onClick={onDiscardRequest}
            >
              {t.queue.discard}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function QueueCenter({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { actions, failedCount } = useQueue()
  const queryClient = useQueryClient()
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | 'all' | null>(null)

  const invalidateQueue = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] })
  }

  const retryAll = async (): Promise<void> => {
    setBusyId('all')
    try {
      await invoke('queue:retry', {})
      invalidateQueue()
    } finally {
      setBusyId(null)
    }
  }

  const retryOne = async (id: number): Promise<void> => {
    setBusyId(id)
    try {
      await invoke('queue:retry', { id })
      invalidateQueue()
    } finally {
      setBusyId(null)
    }
  }

  const discard = async (id: number): Promise<void> => {
    setBusyId(id)
    try {
      await invoke('queue:discard', { id })
      invalidateQueue()
    } finally {
      setBusyId(null)
      setConfirmId(null)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="mx-auto mt-24 w-[520px] max-w-[90vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-bold text-zinc-50">{t.queue.title}</h2>
          <div className="flex items-center gap-2">
            {failedCount > 0 && (
              <Button
                variant="secondary"
                className="!px-2 !py-1 text-xs"
                disabled={busyId === 'all'}
                onClick={() => void retryAll()}
              >
                {busyId === 'all' ? <Spinner /> : null}
                {t.queue.retryAll}
              </Button>
            )}
            <button
              className="rounded p-1 text-zinc-500 hover:text-zinc-200"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {actions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-500">{t.queue.empty}</p>
          ) : (
            actions.map((action) => (
              <QueueRow
                key={action.id}
                action={action}
                busy={busyId === action.id}
                confirming={confirmId === action.id}
                onRetry={() => void retryOne(action.id)}
                onDiscardRequest={() => setConfirmId(action.id)}
                onDiscardCancel={() => setConfirmId(null)}
                onDiscardConfirm={() => void discard(action.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
