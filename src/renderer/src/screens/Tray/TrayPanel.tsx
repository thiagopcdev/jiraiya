import { useQuery } from '@tanstack/react-query'
import { AtSign, ExternalLink, FileText, Pause, Play, RefreshCw, Timer } from 'lucide-react'
import { invoke } from '../../api/client'
import { useIssues, useMentions, useSyncStatus } from '../../api/hooks'
import { pauseTimer, startTimer, useActiveTimer, formatTimer } from '../../lib/timer'
import { Badge } from '../../components/ui'
import { statusColor } from '../../components/statusColor'

/**
 * Painel do popover do tray — janela própria (360x460), sem Shell/sidebar.
 * Fundo herdado do body; queries que falharem (sem workspace, etc.) somem
 * silenciosamente ao invés de mostrar erro — o popover é um resumo rápido,
 * não uma tela de diagnóstico.
 */
export default function TrayPanel(): React.JSX.Element {
  return (
    <div className="space-y-3 p-3 text-sm">
      <Header />
      <ActiveTimerRow />
      <InProgressSection />
      <MentionsRow />
      <DailyRow />
    </div>
  )
}

function Header(): React.JSX.Element {
  const { data: sync } = useSyncStatus()
  const busy = sync?.running ?? false
  return (
    <div className="flex items-center justify-between">
      <span className="font-semibold text-zinc-100">Jiraiya</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-600"
          disabled={busy}
          title="Sincronizar agora"
          onClick={() => void invoke('sync:run', {})}
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Abrir o app"
          onClick={() => void invoke('app:show', {})}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  )
}

function ActiveTimerRow(): React.JSX.Element | null {
  const active = useActiveTimer()
  if (!active) return null
  const { issueKey, running, seconds } = active

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
      <Timer
        size={14}
        className={
          running ? 'animate-pulse text-indigo-400 light:text-indigo-600' : 'text-zinc-500'
        }
      />
      <button
        type="button"
        className="font-medium text-zinc-200 hover:underline"
        onClick={() => void invoke('app:focusIssue', { key: issueKey })}
        title={`Abrir ${issueKey}`}
      >
        {issueKey}
      </button>
      <span className="ml-auto tabular-nums text-zinc-400">{formatTimer(seconds)}</span>
      <button
        type="button"
        className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        title={running ? 'Pausar' : 'Retomar'}
        onClick={() => (running ? pauseTimer(issueKey) : startTimer(issueKey))}
      >
        {running ? <Pause size={13} /> : <Play size={13} />}
      </button>
    </div>
  )
}

function InProgressSection(): React.JSX.Element | null {
  const { data, isError } = useIssues({ type: 'today' }, 'inProgress')
  if (isError) return null
  const issues = (data?.issues ?? []).slice(0, 5)

  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-zinc-400">Em andamento</div>
      {issues.length === 0 ? (
        <p className="text-xs text-zinc-500">Nada em andamento.</p>
      ) : (
        <div className="space-y-0.5">
          {issues.map((i) => (
            <button
              key={i.key}
              type="button"
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-800/70"
              onClick={() => void invoke('app:focusIssue', { key: i.key })}
              title={`Abrir ${i.key}`}
            >
              <span className="shrink-0 font-mono text-xs text-zinc-500">{i.key}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">{i.summary}</span>
              {i.status && <Badge color={statusColor(i.statusCategory)}>{i.status}</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MentionsRow(): React.JSX.Element | null {
  const { data, isError } = useMentions()
  if (isError) return null
  const unread = data?.unreadCount ?? 0
  if (unread === 0) return null

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-left text-amber-200 hover:bg-amber-950/50 light:border-amber-300 light:bg-amber-50 light:text-amber-800"
      onClick={() => void invoke('app:show', {})}
    >
      <AtSign size={14} className="shrink-0" />
      <span>{unread === 1 ? '1 menção não lida' : `${unread} menções não lidas`}</span>
    </button>
  )
}

function DailyRow(): React.JSX.Element | null {
  const { data, isError } = useQuery({
    queryKey: ['briefing-today'],
    queryFn: () => invoke('briefing:today', {}),
    staleTime: 60_000
  })
  if (isError || data?.summaryId == null) return null

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
      <FileText size={14} className="shrink-0 text-indigo-400 light:text-indigo-600" />
      <span className="flex-1 text-zinc-300">Sua daily está pronta</span>
      <button
        type="button"
        className="rounded px-2 py-0.5 text-xs font-medium text-indigo-400 hover:bg-zinc-800 light:text-indigo-600"
        onClick={() => void invoke('app:show', {})}
      >
        Ver
      </button>
    </div>
  )
}
