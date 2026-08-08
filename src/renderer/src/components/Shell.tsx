import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  AtSign,
  Columns3,
  Download,
  Filter,
  FileText,
  Keyboard,
  Layers,
  LayoutDashboard,
  MessageCircleQuestion,
  Pin,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  Users,
  X
} from 'lucide-react'
import appIcon from '../../../../resources/icon.png'
import { invoke } from '../api/client'
import {
  useAlerts,
  useMentions,
  useProjects,
  usePushInvalidation,
  useSprintList,
  useSyncStatus
} from '../api/hooks'
import { Spinner } from './ui'
import { compactAgo } from '../lib/relativeTime'
import { readNavCollapsed, writeNavCollapsed } from '../lib/nav'
import { useQueue } from '../lib/queue'
import { t } from '../strings/ptBR'
import KeyboardShortcuts from './KeyboardShortcuts'
import { ProjectPicker } from './ProjectPicker'
import TimerWidget from './TimerWidget'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /**
   * Rotas que devem acender este item (pares agrupados apontam para a 1ª
   * rota mas ficam ativos na 2ª também, ex.: Criar · Dividir em /dividir).
   */
  activeMatches?: string[]
}

interface NavGroup {
  title: string | null
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    title: null,
    items: [
      { to: '/', label: t.nav.dashboard, icon: LayoutDashboard },
      { to: '/quadro', label: t.nav.board, icon: Columns3 },
      { to: '/epicos', label: t.nav.epics, icon: Layers },
      { to: '/time', label: t.nav.team, icon: Users }
    ]
  },
  {
    title: t.nav.groupEntries,
    items: [
      { to: '/mencoes', label: t.nav.mentions, icon: AtSign },
      { to: '/alertas', label: t.nav.alerts, icon: AlertTriangle },
      { to: '/resumos', label: t.nav.summaries, icon: FileText }
    ]
  },
  {
    title: t.nav.groupTools,
    items: [
      { to: '/perguntar', label: t.nav.ask, icon: MessageCircleQuestion },
      {
        to: '/criar',
        label: t.nav.createSplit,
        icon: SquarePen,
        activeMatches: ['/criar', '/dividir']
      },
      {
        to: '/filtros',
        label: t.nav.filtersTimeline,
        icon: Filter,
        activeMatches: ['/filtros', '/timeline']
      }
    ]
  }
]

const SETTINGS_ROUTE = '/config'

interface NavCounts {
  alerts: number
  mentions: number
}

/**
 * Crachá do item: menções usam o destaque secundário do DS (o único lugar do
 * app com `accent`); alertas ficam neutros — a severidade já é dita na tela.
 */
function badgeOf(to: string, counts: NavCounts): { count: number; accent: boolean } | null {
  if (to === '/mencoes' && counts.mentions > 0) return { count: counts.mentions, accent: true }
  if (to === '/alertas' && counts.alerts > 0) return { count: counts.alerts, accent: false }
  return null
}

function isActiveItem(item: NavItem, pathname: string): boolean {
  return (item.activeMatches ?? [item.to]).includes(pathname)
}

function NavItemLink({
  item,
  pathname,
  counts,
  onNavigate
}: {
  item: NavItem
  pathname: string
  counts: NavCounts
  /** fecha o painel flutuante do trilho recolhido ao trocar de rota */
  onNavigate?: () => void
}): React.JSX.Element {
  const isActive = isActiveItem(item, pathname)
  const badge = badgeOf(item.to, counts)
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] transition-colors ${
        isActive
          ? 'bg-indigo-600/12 font-semibold text-indigo-400'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge && (
        <span
          className={`shrink-0 rounded-full px-[7px] text-[11px] font-bold ${
            badge.accent ? 'bg-accent/16 text-accent' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {badge.count}
        </span>
      )}
    </Link>
  )
}

/** Item do trilho recolhido: alvo de 38×34 (o mínimo aceito pelo handoff). */
function NavItemRail({
  item,
  pathname,
  counts
}: {
  item: NavItem
  pathname: string
  counts: NavCounts
}): React.JSX.Element {
  const isActive = isActiveItem(item, pathname)
  const badge = badgeOf(item.to, counts)
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      aria-current={isActive ? 'page' : undefined}
      aria-label={badge ? `${item.label}: ${badge.count}` : item.label}
      title={item.label}
      className={`relative flex h-[34px] w-[38px] items-center justify-center rounded-md transition-colors ${
        isActive
          ? 'bg-indigo-600/12 text-indigo-400'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
      }`}
    >
      <Icon size={17} />
      {badge && (
        // border-2 na cor da superfície: o pontinho fica destacado por cima do
        // ícone sem virar mancha.
        <span
          className={`absolute top-1 right-[5px] size-[7px] rounded-full border-2 border-zinc-900 ${
            badge.accent ? 'bg-accent' : 'bg-zinc-500'
          }`}
        />
      )}
    </Link>
  )
}

function GroupTitle({ children }: { children: string }): React.JSX.Element {
  return (
    <p className="mx-3 mt-3 mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-zinc-600">
      {children}
    </p>
  )
}

/** Lista completa (sidebar expandida e painel flutuante do trilho). */
function NavList({
  pathname,
  counts,
  onNavigate
}: {
  pathname: string
  counts: NavCounts
  onNavigate?: () => void
}): React.JSX.Element {
  return (
    <>
      {navGroups.map((group, index) => (
        <div key={group.title ?? `group-${index}`}>
          {group.title && <GroupTitle>{group.title}</GroupTitle>}
          {group.items.map((item) => (
            <NavItemLink
              key={item.to}
              item={item}
              pathname={pathname}
              counts={counts}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </>
  )
}

type SyncData = ReturnType<typeof useSyncStatus>['data']

interface SyncView {
  spinner: boolean
  /** cor do ícone */
  tone: string
  /** cor do rótulo — neutra no estado saudável, para o verde não gritar */
  labelTone: string
  label: string
  title: string
}

/**
 * Uma linha só para o estado de sincronização: absorve o antigo QueueBadge —
 * havendo fila offline ela é a informação mais importante e vem em âmbar, à
 * frente do "há X min".
 */
function describeSync(sync: SyncData, queueTotal: number): SyncView {
  if (sync?.running) {
    return {
      spinner: true,
      tone: 'text-zinc-400',
      labelTone: 'text-zinc-400',
      label: t.sync.syncing,
      title: t.sync.phases[sync.progress?.phase ?? ''] ?? t.sync.syncing
    }
  }
  if (queueTotal > 0) {
    const tone = 'text-amber-400 light:text-amber-600'
    return {
      spinner: false,
      tone,
      labelTone: tone,
      label: `${queueTotal} na fila`,
      title: t.queue.badgeTitle
    }
  }
  if (sync?.lastError) {
    const tone = 'text-red-400 light:text-red-600'
    return {
      spinner: false,
      tone,
      labelTone: tone,
      label: t.sync.error,
      title: sync.lastError
    }
  }
  if (sync?.lastSuccessAt) {
    const ago = compactAgo(sync.lastSuccessAt)
    return {
      spinner: false,
      tone: 'text-green-400 light:text-green-600',
      labelTone: 'text-zinc-400',
      label: ago,
      title: t.sync.lastSync(ago)
    }
  }
  return {
    spinner: false,
    tone: 'text-zinc-500',
    labelTone: 'text-zinc-500',
    label: t.sync.never,
    title: t.sync.never
  }
}

const iconButton =
  'flex shrink-0 items-center justify-center rounded-md p-[5px] text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200'

function showShortcuts(): void {
  window.dispatchEvent(new Event('jiraiya:show-shortcuts'))
}

function openPalette(): void {
  window.dispatchEvent(new Event('jiraiya:open-palette'))
}

export default function Shell(): React.JSX.Element {
  usePushInvalidation()
  const location = useLocation()
  const { data: sync } = useSyncStatus()
  const { data: alertsData } = useAlerts()
  const { data: mentionsData } = useMentions()
  const { data: projectsData } = useProjects()
  const { data: sprintsData } = useSprintList()
  const { pendingCount, failedCount } = useQueue()
  const counts: NavCounts = {
    alerts: alertsData?.alerts.length ?? 0,
    mentions: mentionsData?.unreadCount ?? 0
  }
  const syncView = describeSync(sync, pendingCount + failedCount)

  // Linha de contexto abaixo do wordmark: projeto acompanhado + sprint ativa,
  // ambos já vindos das queries que o app faz de qualquer jeito.
  const selectedProjects = projectsData?.projects.filter((p) => p.selected) ?? []
  const projectLabel =
    selectedProjects.length === 1
      ? selectedProjects[0].name
      : selectedProjects.length > 1
        ? `${selectedProjects.length} projetos`
        : null
  const activeSprint = sprintsData?.sprints.find((s) => s.state === 'active') ?? null
  const workspaceLabel = [projectLabel, activeSprint?.name].filter(Boolean).join(' · ')

  const [collapsed, setCollapsed] = useState(readNavCollapsed)
  const [floating, setFloating] = useState(false)
  const floatingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 200ms para abrir e 300ms para fechar: o painel não pisca quando o mouse só
   * atravessa o trilho a caminho do conteúdo. */
  const scheduleFloating = (open: boolean): void => {
    if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current)
    floatingTimerRef.current = setTimeout(() => setFloating(open), open ? 200 : 300)
  }

  const closeFloating = (): void => {
    if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current)
    setFloating(false)
  }

  useEffect(
    () => () => {
      if (floatingTimerRef.current) clearTimeout(floatingTimerRef.current)
    },
    []
  )

  // ⌘B alterna trilho recolhido / nav fixada aberta.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return
      // Ctrl+B é o "voltar um caractere" nativo do Chromium dentro de campo de
      // texto. Sequestrar isso quebraria a digitação no composer de comentário,
      // no Perguntar, no Criar e no JQL dos Filtros.
      const alvo = e.target as HTMLElement | null
      if (
        alvo &&
        (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      setCollapsed((prev) => {
        writeNavCollapsed(!prev)
        return !prev
      })
      setFloating(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const expand = (): void => {
    writeNavCollapsed(false)
    setCollapsed(false)
    setFloating(false)
  }

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
  const showUpdate = update !== null && !updateDismissed

  const settingsActive = location.pathname === SETTINGS_ROUTE
  const settingsClass = `${iconButton} ${settingsActive ? 'bg-indigo-600/12 text-indigo-400' : ''}`

  const syncButton = (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition-colors hover:bg-zinc-800/60 disabled:cursor-default disabled:hover:bg-transparent"
      disabled={sync?.running}
      aria-label={sync?.running ? t.sync.syncing : t.sync.syncNow}
      title={syncView.title}
      onClick={() => void invoke('sync:run', {})}
    >
      {syncView.spinner ? (
        <Spinner className={`shrink-0 ${syncView.tone}`} />
      ) : (
        <RefreshCw size={14} className={`shrink-0 ${syncView.tone}`} />
      )}
      <span className={`truncate ${syncView.labelTone}`}>{syncView.label}</span>
    </button>
  )

  return (
    <div className="flex h-full">
      {collapsed ? (
        <div
          className="relative flex shrink-0"
          onMouseEnter={() => scheduleFloating(true)}
          onMouseLeave={() => scheduleFloating(false)}
        >
          <aside className="flex w-14 flex-col items-center border-r border-zinc-800 bg-zinc-900">
            <div
              className="h-8 w-full shrink-0"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />
            <img
              src={appIcon}
              alt={t.app.name}
              className="mt-1.5 mb-3 size-7 rounded-md"
              draggable={false}
            />
            <button
              type="button"
              className={`${iconButton} h-[34px] w-[38px] p-0`}
              aria-label="Buscar"
              title="Buscar (⌘K)"
              onClick={openPalette}
            >
              <Search size={16} />
            </button>
            <nav className="flex flex-1 flex-col items-center gap-[3px] pt-2">
              {navGroups.map((group, index) => (
                <div
                  key={group.title ?? `group-${index}`}
                  className="flex flex-col items-center gap-[3px]"
                >
                  {group.title && (
                    <>
                      <span className="my-[7px] h-px w-6 bg-zinc-800" />
                      <span className="sr-only">{group.title}</span>
                    </>
                  )}
                  {group.items.map((item) => (
                    <NavItemRail
                      key={item.to}
                      item={item}
                      pathname={location.pathname}
                      counts={counts}
                    />
                  ))}
                </div>
              ))}
            </nav>
            <div className="flex w-full flex-col items-center gap-0.5 border-t border-zinc-800 py-2">
              {showUpdate && (
                <a
                  href={update.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`${iconButton} h-8 w-[38px] p-0 text-indigo-400 light:text-indigo-600`}
                  title={t.app.updateAvailable(update.version)}
                  aria-label={t.app.updateAvailable(update.version)}
                >
                  <Download size={16} />
                </a>
              )}
              <button
                type="button"
                className={`${iconButton} h-8 w-[38px] p-0`}
                disabled={sync?.running}
                aria-label={sync?.running ? t.sync.syncing : t.sync.syncNow}
                title={syncView.title}
                onClick={() => void invoke('sync:run', {})}
              >
                {syncView.spinner ? (
                  <Spinner className={syncView.tone} />
                ) : (
                  <RefreshCw size={16} className={syncView.tone} />
                )}
              </button>
              <button
                type="button"
                className={`${iconButton} h-8 w-[38px] p-0`}
                aria-label="Atalhos do teclado"
                title="Atalhos do teclado (?)"
                onClick={showShortcuts}
              >
                <Keyboard size={16} />
              </button>
              <Link
                to={SETTINGS_ROUTE}
                aria-current={settingsActive ? 'page' : undefined}
                aria-label={t.nav.settings}
                title={t.nav.settings}
                className={`${settingsClass} h-8 w-[38px] p-0`}
              >
                <Settings size={16} />
              </Link>
            </div>
          </aside>

          {floating && (
            <div className="absolute top-2 left-[62px] z-40 w-54 rounded-lg border border-zinc-700 bg-zinc-800 shadow-2xl">
              <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
                <span className="text-[15px] font-extrabold tracking-[-.2px] text-zinc-50">
                  {t.app.name}
                </span>
                <button
                  type="button"
                  className={`${iconButton} ml-auto`}
                  aria-label="Fixar a barra lateral"
                  title="Fixar a barra lateral (⌘B)"
                  onClick={expand}
                >
                  <Pin size={13} />
                </button>
              </div>
              <nav className="px-2 pb-2">
                <NavList pathname={location.pathname} counts={counts} onNavigate={closeFloating} />
              </nav>
            </div>
          )}
        </div>
      ) : (
        <aside className="flex w-54 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <div
            className="h-8 shrink-0"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          />
          <div
            className="mx-2.5 flex items-center gap-2 px-1.5"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div className="min-w-0">
              <div className="text-[16px] font-extrabold tracking-[-.2px] text-zinc-50">
                {t.app.name}
              </div>
              {workspaceLabel && (
                <div className="mt-px truncate text-[11px] text-zinc-500">{workspaceLabel}</div>
              )}
            </div>
            <div className="ml-auto">
              <ProjectPicker />
            </div>
          </div>
          <button
            type="button"
            className="mx-2.5 mt-2.5 mb-1 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[12.5px] text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-400"
            onClick={openPalette}
          >
            <Search size={13} className="shrink-0" />
            <span className="flex-1 text-left">Buscar</span>
            <kbd className="rounded-sm border border-zinc-800 px-1 font-sans text-[10px] text-zinc-600">
              ⌘K
            </kbd>
          </button>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pt-1">
            <NavList pathname={location.pathname} counts={counts} />
          </nav>
          {showUpdate && (
            <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-md bg-zinc-800/60 px-2 py-1.5">
              <a
                href={update.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-indigo-400 hover:underline light:text-indigo-600"
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
          <div className="flex items-center gap-1 border-t border-zinc-800 px-2.5 py-2.5">
            {syncButton}
            <button
              type="button"
              className={iconButton}
              aria-label="Atalhos do teclado"
              title="Atalhos do teclado (?)"
              onClick={showShortcuts}
            >
              <Keyboard size={15} />
            </button>
            <Link
              to={SETTINGS_ROUTE}
              aria-current={settingsActive ? 'page' : undefined}
              aria-label={t.nav.settings}
              title={t.nav.settings}
              className={settingsClass}
            >
              <Settings size={15} />
            </Link>
          </div>
        </aside>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <TimerWidget />
      <KeyboardShortcuts />
    </div>
  )
}
