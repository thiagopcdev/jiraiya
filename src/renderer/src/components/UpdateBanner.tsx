import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Download, ExternalLink, X } from 'lucide-react'
import { invoke, IpcError } from '../api/client'

interface UpdateInfo {
  version: string
  url: string
}

type Phase = 'idle' | 'downloading' | 'done' | 'error'

/**
 * Pill flutuante global (rodapé direito, acima do TimerWidget) — aparece
 * quando o main empurra `push:update-available`. Fica fora do fluxo de
 * rotas (montado direto no App), mas nunca no popover do tray, compacto
 * demais pra esse fluxo.
 */
export default function UpdateBanner(): React.JSX.Element | null {
  const location = useLocation()
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const offAvailable = window.api.on('push:update-available', (payload) => {
      setUpdate(payload)
      setDismissed(false)
      setPhase('idle')
      setPercent(0)
      setError(null)
    })
    const offProgress = window.api.on('push:update-progress', (payload) => {
      setPercent(payload.percent)
    })
    return () => {
      offAvailable()
      offProgress()
    }
  }, [])

  // conclusão: mensagem some sozinha após 5s (some, mas não reaparece até novo push)
  useEffect(() => {
    if (phase !== 'done') return
    const timeout = window.setTimeout(() => setDismissed(true), 5000)
    return () => window.clearTimeout(timeout)
  }, [phase])

  if (location.pathname === '/tray') return null
  if (!update || dismissed) return null

  const download = async (): Promise<void> => {
    setPhase('downloading')
    setPercent(0)
    setError(null)
    try {
      await invoke('update:download', {})
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setError(e instanceof IpcError ? e.message : 'Falha ao baixar a atualização.')
    }
  }

  return (
    <div className="fixed right-4 bottom-16 z-50 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
      {phase === 'error' ? (
        <>
          <span className="text-amber-400 light:text-amber-600">{error}</span>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-medium text-indigo-400 hover:bg-zinc-800 light:text-indigo-600"
            onClick={() => void download()}
          >
            Tentar de novo
          </button>
        </>
      ) : phase === 'done' ? (
        <span className="text-zinc-200">Instalador aberto — conclua a instalação</span>
      ) : (
        <>
          <span className="text-zinc-200">Versão {update.version} disponível</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600 light:text-indigo-600"
            disabled={phase === 'downloading'}
            onClick={() => void download()}
          >
            <Download size={13} />
            {phase === 'downloading' ? `Baixando… ${percent}%` : 'Baixar e instalar'}
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => window.open(update.url, '_blank')}
          >
            <ExternalLink size={13} />
            Ver release
          </button>
        </>
      )}
      {phase !== 'done' && (
        <button
          type="button"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          title="Fechar"
          onClick={() => setDismissed(true)}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
