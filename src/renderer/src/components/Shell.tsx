import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  AtSign,
  Calendar,
  Columns3,
  Filter,
  FileText,
  Layers,
  LayoutDashboard,
  MessageCircleQuestion,
  RefreshCw,
  Settings,
  Split,
  SquarePen,
  Users,
  X
} from 'lucide-react'
import { invoke } from '../api/client'
import { useAlerts, useMentions, usePushInvalidation, useSyncStatus } from '../api/hooks'
import { Spinner } from './ui'
import { compactAgo } from '../lib/relativeTime'
import { t } from '../strings/ptBR'
import TimerWidget from './TimerWidget'

const navItems = [
  { to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
  { to: '/quadro', label: t.nav.board, icon: Columns3 },
  { to: '/epicos', label: t.nav.epics, icon: Layers },
  { to: '/perguntar', label: t.nav.ask, icon: MessageCircleQuestion },
  { to: '/filtros', label: t.nav.filters, icon: Filter },
  { to: '/criar', label: t.nav.create, icon: SquarePen },
  { to: '/dividir', label: t.nav.split, icon: Split },
  { to: '/timeline', label: t.nav.timeline, icon: Calendar },
  { to: '/mencoes', label: t.nav.mentions, icon: AtSign },
  { to: '/resumos', label: t.nav.summaries, icon: FileText },
  { to: '/time', label: t.nav.team, icon: Users },
  { to: '/alertas', label: t.nav.alerts, icon: AlertTriangle },
  { to: '/config', label: t.nav.settings, icon: Settings }
]

export default function Shell(): React.JSX.Element {
  usePushInvalidation()
  const { data: sync } = useSyncStatus()
  const { data: alertsData } = useAlerts()
  const { data: mentionsData } = useMentions()
  const alertCount = alertsData?.alerts.length ?? 0
  const mentionsUnreadCount = mentionsData?.unreadCount ?? 0

  // Push de update disponível (empurrado pelo main a qualquer momento).
  const [pushUpdate, setPushUpdate] = useState<{ version: string; url: string } | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  useEffect(() => {
    const off = window.api.on('push:update-available', (payload) => {
      setPushUpdate(payload)
      setUpdateDismissed(false)
    })
    return () => off()
  }, [])

  // Checagem periódica de update (independente do push), em cache por 6h.
  const { data: updateCheck } = useQuery({
    queryKey: ['update-check'],
    queryFn: () => invoke('update:check', {}),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 0
  })
  const checkedUpdate =
    updateCheck?.available && updateCheck.latest && updateCheck.url
      ? { version: updateCheck.latest, url: updateCheck.url }
      : null
  const update = pushUpdate ?? checkedUpdate

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
        <div
          className="px-4 pt-10 pb-4 text-lg font-bold text-zinc-100"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {t.app.name}
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60'
                }`
              }
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {to === '/alertas' && alertCount > 0 && (
                <span className="rounded-full bg-red-900/70 px-1.5 text-xs font-semibold text-red-200">
                  {alertCount}
                </span>
              )}
              {to === '/mencoes' && mentionsUnreadCount > 0 && (
                <span className="rounded-full bg-indigo-900/70 px-1.5 text-xs font-semibold text-indigo-200">
                  {mentionsUnreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-3">
          {update && !updateDismissed && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-zinc-800/60 px-2 py-1.5">
              <a
                href={update.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-indigo-400 hover:underline"
              >
                {t.app.updateAvailable(update.version)}
              </a>
              <button
                className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                aria-label={t.common.dismiss}
                onClick={() => setUpdateDismissed(true)}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800 disabled:cursor-default disabled:text-zinc-500"
            disabled={sync?.running}
            onClick={() => void invoke('sync:run', {})}
          >
            {sync?.running ? <Spinner /> : <RefreshCw size={14} />}
            <span>{sync?.running ? t.sync.syncing : t.sync.syncNow}</span>
          </button>
          {sync?.running ? (
            <p className="mt-1 px-2 text-xs leading-tight text-zinc-500">
              {t.sync.phases[sync.progress?.phase ?? ''] ?? ''}
            </p>
          ) : sync?.lastError ? (
            <p className="mt-1 px-2 text-xs leading-tight text-red-400" title={sync.lastError}>
              {t.sync.error}
            </p>
          ) : sync?.lastSuccessAt ? (
            <p
              className="mt-1 px-2 text-xs leading-tight text-zinc-500"
              title={new Date(sync.lastSuccessAt).toLocaleString('pt-BR')}
            >
              {t.sync.lastSync(compactAgo(sync.lastSuccessAt))}
            </p>
          ) : (
            <p className="mt-1 px-2 text-xs leading-tight text-zinc-500">{t.sync.never}</p>
          )}
          <p className="mt-2 px-2 text-xs leading-tight text-zinc-600">{t.app.paletteHint}</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <TimerWidget />
    </div>
  )
}
