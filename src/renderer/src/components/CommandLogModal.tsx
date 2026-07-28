import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { invoke } from '../api/client'
import { compactAgo } from '../lib/relativeTime'
import { Badge, Button, Spinner } from './ui'

/**
 * Auditoria de comandos externos disparados pelo app (CLIs de IA e `gh`). Portal no body
 * pelo mesmo motivo do AttachmentLightbox (attachments.tsx): a gaveta tem transform
 * (slide-in), então um `fixed` comum aqui ficaria relativo à gaveta em vez do viewport.
 */
export function CommandLogModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['command-log'],
    queryFn: () => invoke('commandLog:list', {}),
    refetchOnMount: 'always'
  })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const entries = data?.entries ?? []

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const toggleExpand = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clear = async (): Promise<void> => {
    setClearing(true)
    try {
      await invoke('commandLog:clear', {})
      await queryClient.invalidateQueries({ queryKey: ['command-log'] })
      setConfirmClear(false)
    } finally {
      setClearing(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl light:border-zinc-200 light:bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4 light:border-zinc-200">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100 light:text-zinc-900">
              Comandos executados
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Comandos externos disparados pelo app (IA e gh), com argumentos truncados.
            </p>
          </div>
          <button
            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 light:hover:bg-zinc-100"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <Spinner className="text-zinc-500" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum comando registrado.</p>
          ) : (
            <div className="divide-y divide-zinc-800 light:divide-zinc-200">
              {entries.map((entry) => (
                <div key={entry.id} className="space-y-1 py-2.5 first:pt-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="shrink-0">{compactAgo(entry.ts)}</span>
                    <Badge color="zinc">{entry.provider}</Badge>
                    {entry.feature && (
                      <span className="truncate text-zinc-600">{entry.feature}</span>
                    )}
                    {entry.durationMs != null && (
                      <span className="ml-auto shrink-0 tabular-nums">
                        {(entry.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <button
                    className={`block w-full rounded bg-zinc-950/60 px-2 py-1 text-left font-mono text-xs text-zinc-400 light:bg-zinc-100 light:text-zinc-600 ${
                      expanded.has(entry.id) ? 'break-all whitespace-pre-wrap' : 'truncate'
                    }`}
                    onClick={() => toggleExpand(entry.id)}
                    title={entry.command}
                  >
                    {entry.command}
                  </button>
                  {!entry.ok && (
                    <p
                      className="text-xs text-red-400 light:text-red-600"
                      title={entry.error ?? undefined}
                    >
                      {entry.error ?? 'Falhou'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-3 light:border-zinc-200">
          {confirmClear ? (
            <>
              <span className="text-xs text-zinc-500">Limpar histórico?</span>
              <Button variant="danger" disabled={clearing} onClick={() => void clear()}>
                {clearing && <Spinner />}
                Sim
              </Button>
              <Button variant="ghost" disabled={clearing} onClick={() => setConfirmClear(false)}>
                Não
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              disabled={entries.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Limpar histórico
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
