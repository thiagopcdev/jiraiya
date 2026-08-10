import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Timer, X } from 'lucide-react'
import { invoke, IpcError } from '../api/client'
import {
  formatJiraDuration,
  formatTimer,
  pauseTimer,
  resetTimer,
  startTimer,
  useActiveTimer
} from '../lib/timer'
import { useIssueDetail } from './issueDetail'

/** Pill flutuante do timer de trabalho ativo — some quando nenhum timer está em uso. */
export default function TimerWidget(): React.JSX.Element | null {
  const active = useActiveTimer()
  const queryClient = useQueryClient()
  const { openIssue } = useIssueDetail()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!active) return null
  const { issueKey, running, seconds } = active

  const logWork = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:logWork', {
        key: issueKey,
        timeSpent: formatJiraDuration(seconds),
        comment: 'Registrado pelo timer do Jiraiya'
      })
      resetTimer(issueKey)
      void queryClient.invalidateQueries({ queryKey: ['worklogs', issueKey] })
    } catch (e) {
      setError(e instanceof IpcError ? e.message : 'Falha ao registrar o tempo.')
    } finally {
      setBusy(false)
    }
  }

  const discard = (): void => {
    if (window.confirm('Descartar o tempo cronometrado?')) {
      resetTimer(issueKey)
    }
  }

  return (
    // superfície sólida: o /95 com blur sobre a base azul-ardósia suja a cor
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12.5px] shadow-2xl">
      <Timer
        size={15}
        className={
          running ? 'animate-pulse text-indigo-400 light:text-indigo-600' : 'text-zinc-500'
        }
      />
      <button
        type="button"
        className="font-mono font-medium text-indigo-400 hover:underline light:text-indigo-600"
        onClick={() => openIssue(issueKey)}
      >
        {issueKey}
      </button>
      <span className="tabular-nums text-zinc-400">{formatTimer(seconds)}</span>
      <button
        type="button"
        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-600"
        disabled={busy}
        title={running ? 'Pausar' : 'Retomar'}
        onClick={() => (running ? pauseTimer(issueKey) : startTimer(issueKey))}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      {!running && (
        <button
          type="button"
          className={`rounded px-2 py-1 text-xs font-medium hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600 ${
            error ? 'text-red-400 light:text-red-600' : 'text-indigo-400 light:text-indigo-600'
          }`}
          disabled={busy}
          title={error ?? undefined}
          onClick={() => void logWork()}
        >
          Registrar
        </button>
      )}
      <button
        type="button"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed"
        disabled={busy}
        title="Descartar"
        onClick={discard}
      >
        <X size={14} />
      </button>
    </div>
  )
}
