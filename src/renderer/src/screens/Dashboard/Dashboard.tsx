import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowRightLeft,
  CheckCircle2,
  Columns3,
  FileText,
  MessageSquare,
  Rows3
} from 'lucide-react'
import type { Period } from '@shared/periods'
import type { DensityPref, Issue, Sprint } from '@shared/domain'
import { invoke } from '../../api/client'
import { useAuthStatus, useIssues, useLeadTime, usePrefs } from '../../api/hooks'
import { computeBurndown } from '../../lib/burndown'
import { BurndownChart } from '../../components/BurndownChart'
import { applyDensityPref } from '../../lib/density'
import { Badge, Card, CollapsedStats, ScreenHeader } from '../../components/ui'
import { IssuesByStatus } from '../../components/IssuesByStatus'
import { useIssueDetail } from '../../components/issueDetail'
import { t } from '../../strings/ptBR'

const periodTabs: Array<{ key: string; label: string; period: Period }> = [
  { key: 'today', label: t.today.periodToday, period: { type: 'today' } },
  { key: '7d', label: t.today.period7d, period: { type: '7d' } },
  { key: 'sprint', label: t.today.periodSprint, period: { type: 'sprint' } }
]

export default function Dashboard(): React.JSX.Element {
  const [tab, setTab] = useState(periodTabs[0])
  const { data: prefs } = usePrefs()
  const { data: authStatus } = useAuthStatus()
  const accountId = authStatus?.workspace?.accountId ?? null

  const { data: sprintData } = useQuery({
    queryKey: ['sprint-active'],
    queryFn: () => invoke('sprint:active', {})
  })
  const sprint = sprintData?.sprint ?? null

  const { data: sprintScopeData } = useIssues({ type: 'sprint' }, 'sprintScope')
  const sprintScopeIssues = useMemo(() => sprintScopeData?.issues ?? [], [sprintScopeData])

  const { data: inProgressData } = useIssues(tab.period, 'inProgress')
  const inProgressIssues = useMemo(() => inProgressData?.issues ?? [], [inProgressData])

  const { data: rejectedData } = useIssues({ type: '7d' }, 'rejected')
  const rejectedIssues = rejectedData?.issues ?? []

  const { data: stalledData } = useIssues({ type: '7d' }, 'stalled')
  const stalledIssues = stalledData?.issues ?? []

  // "sem estimativa" não tem bucket próprio — deriva do escopo da sprint no
  // cliente (regra do handoff), sem precisar de canal IPC novo.
  const noEstimateIssues = useMemo(
    () => sprintScopeIssues.filter((i) => i.storyPoints === null),
    [sprintScopeIssues]
  )

  // "mais parado primeiro": quem não mexe há mais tempo sobe ao topo da lista.
  const sortedInProgress = useMemo(
    () => [...inProgressIssues].sort((a, b) => activityTime(a) - activityTime(b)),
    [inProgressIssues]
  )

  const mySprintIssues = useMemo(
    () => (accountId ? sprintScopeIssues.filter((i) => i.assigneeAccountId === accountId) : []),
    [sprintScopeIssues, accountId]
  )
  const mySprintPoints = mySprintIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)

  const todoInSprint = useMemo(
    () =>
      accountId
        ? sprintScopeIssues.filter(
            (i) => i.statusCategory === 'new' && i.assigneeAccountId === accountId
          )
        : [],
    [sprintScopeIssues, accountId]
  )
  const todoPoints = todoInSprint.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)

  const contextLine = t.today.context(
    formatTodayLabel(new Date()),
    sprint?.name ?? null,
    inProgressIssues.length
  )

  return (
    <div className="flex h-full flex-col">
      {/* flush: quem fecha o bloco do cabeçalho é a faixa de abas de período */}
      <ScreenHeader
        title={t.today.title}
        context={contextLine}
        flush
        actions={
          <>
            <DensityToggle density={prefs?.density ?? 'comfortable'} />
            <BriefingButton />
          </>
        }
      />
      <PeriodTabs tab={tab} onChange={setTab} />
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-[18px]">
        <SprintStrip sprint={sprint} issues={sprintScopeIssues} />

        <CollapsedStats
          items={[
            { label: t.today.attentionRejected, count: rejectedIssues.length },
            { label: t.today.attentionStalled, count: stalledIssues.length },
            { label: t.today.attentionNoEstimate, count: noEstimateIssues.length }
          ]}
          allClearLabel={t.today.allClear}
        >
          <AttentionSections
            rejected={rejectedIssues}
            stalled={stalledIssues}
            noEstimate={noEstimateIssues}
          />
        </CollapsedStats>

        <div className="grid grid-cols-1 items-start gap-3.5 min-[1100px]:grid-cols-[minmax(0,1.75fr)_340px]">
          <InProgressPanel
            issues={sortedInProgress}
            stalledDays={prefs?.stalledDays ?? 3}
            todoInSprint={todoInSprint}
            todoPoints={todoPoints}
            totalCount={mySprintIssues.length}
            totalPoints={mySprintPoints}
          />
          <div className="flex min-w-0 flex-col gap-3.5">
            <ActivityCard period={tab.period} />
            <LeadTimeCard />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Referência de atividade da issue (mais recente primeiro nas ordenações). */
function activityTime(issue: Issue): number {
  const ref = issue.updatedAt ?? issue.createdAt
  return ref ? new Date(ref).getTime() : 0
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** "quinta, 2 de agosto" — o `EEEE` do date-fns devolve "quinta-feira", mais
 * longo do que cabe na linha de contexto do cabeçalho. */
function formatTodayLabel(now: Date): string {
  const weekday = WEEKDAYS[now.getDay()]
  const day = format(now, "d 'de' MMMM", { locale: ptBR })
  return `${weekday}, ${day}`
}

/**
 * Período como faixa de abas sublinhadas (mesma geometria do `PairTabs`), e não
 * como segmented nas ações: o período reorganiza a tela inteira, então merece a
 * linha própria abaixo do título — as ações do cabeçalho ficam para controles.
 */
function PeriodTabs({
  tab,
  onChange
}: {
  tab: (typeof periodTabs)[number]
  onChange: (next: (typeof periodTabs)[number]) => void
}): React.JSX.Element {
  return (
    <nav aria-label="Período" className="flex border-b border-zinc-800 bg-zinc-900 px-5">
      {periodTabs.map((item) => {
        const active = tab.key === item.key
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3.5 pt-2 pb-2.5 text-[13px] transition-colors ${
              active
                ? 'border-indigo-500 font-semibold text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
            onClick={() => onChange(item)}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}

function DensityToggle({ density }: { density: DensityPref }): React.JSX.Element {
  const queryClient = useQueryClient()

  const toggle = async (): Promise<void> => {
    const next: DensityPref = density === 'compact' ? 'comfortable' : 'compact'
    // otimista: aplica antes do round-trip do IPC, senão o toggle parece travado
    applyDensityPref(next)
    await invoke('prefs:set', { density: next })
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  return (
    <button
      className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-[5px] text-[12.5px] text-zinc-400 transition-colors hover:text-zinc-200"
      onClick={() => void toggle()}
      title={t.density.label}
    >
      <Rows3 size={14} />
      {density === 'compact' ? t.density.compact : t.density.comfortable}
    </button>
  )
}

// dispensa persistida por id do resumo: sobrevive à navegação/reinício e o
// atalho volta sozinho no dia seguinte (novo resumo = novo id)
const DISMISSED_BRIEFING_KEY = 'jiraiya.dismissedBriefingId'

function BriefingButton(): React.JSX.Element | null {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dismissedId, setDismissedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(DISMISSED_BRIEFING_KEY)
    return stored ? Number(stored) : null
  })
  const { data } = useQuery({
    queryKey: ['briefing-today'],
    queryFn: () => invoke('briefing:today', {}),
    staleTime: 60_000
  })

  useEffect(() => {
    const off = window.api.on('push:briefing-ready', () => {
      void queryClient.invalidateQueries({ queryKey: ['briefing-today'] })
    })
    return off
  }, [queryClient])

  if (data?.summaryId == null || data.summaryId === dismissedId) return null

  return (
    <button
      className="flex items-center gap-1.5 rounded-md border border-indigo-600/45 bg-indigo-600/12 px-2.5 py-[5px] text-[12.5px] font-semibold text-indigo-400"
      onClick={() => {
        // ver = ciente: dispensa junto, senão o atalho fica lá até o dia
        // seguinte mesmo depois de o usuário já ter visto a daily
        localStorage.setItem(DISMISSED_BRIEFING_KEY, String(data.summaryId))
        setDismissedId(data.summaryId)
        void navigate('/resumos')
      }}
    >
      <FileText size={14} />
      {t.today.dailyReady}
    </button>
  )
}

function SprintStrip({
  sprint,
  issues
}: {
  sprint: Sprint | null
  issues: Issue[]
}): React.JSX.Element {
  const done = issues.filter((i) => i.statusCategory === 'done').length
  const open = issues.length - done
  const pointsLeft = issues.reduce(
    (sum, i) => (i.statusCategory !== 'done' ? sum + (i.storyPoints ?? 0) : sum),
    0
  )
  const daysLeft = sprint?.endDate
    ? differenceInCalendarDays(new Date(sprint.endDate), new Date())
    : null
  const pct = issues.length > 0 ? Math.round((done / issues.length) * 100) : null

  const burndown = useMemo(
    () =>
      sprint?.startDate && sprint.endDate
        ? computeBurndown(issues, sprint.startDate, sprint.endDate)
        : null,
    [issues, sprint]
  )

  return (
    <Card bodyClassName="flex items-center gap-6 px-4 py-3">
      <div className="flex min-w-[130px] flex-col gap-0.5">
        <span className="text-sm font-bold text-zinc-50">{sprint?.name ?? t.today.sprintNone}</span>
        {daysLeft !== null && (
          <span
            className={`text-xs font-semibold ${
              daysLeft <= 2 ? 'text-amber-400 light:text-amber-600' : 'text-zinc-500'
            }`}
          >
            {daysLeft < 0
              ? t.today.sprintEnded
              : daysLeft === 0
                ? t.today.sprintEndsToday
                : t.today.sprintEndsIn(daysLeft)}
          </span>
        )}
      </div>
      <div className="flex gap-6">
        <MiniStat value={issues.length} label={t.today.statInSprint} />
        <MiniStat value={done} label={t.today.statDone} />
        <MiniStat value={open} label={t.today.statOpen} />
        <MiniStat value={pointsLeft} label={t.today.statPointsLeft} />
      </div>
      <div className="ml-auto flex items-center gap-4">
        {burndown && sprint?.startDate && sprint.endDate && burndown.scope > 0 && (
          <div className="h-11 w-[220px]">
            <BurndownChart
              burndown={burndown}
              sprintStart={sprint.startDate}
              sprintEnd={sprint.endDate}
            />
          </div>
        )}
        {pct !== null && (
          <div
            className="relative size-11 shrink-0 rounded-full"
            // sem transição de propósito: o anel remontaria a cada refetch do
            // TanStack Query e piscaria a cada 30s
            style={{
              background: `conic-gradient(var(--chart-accent) 0% ${pct}%, var(--color-zinc-800) ${pct}% 100%)`
            }}
          >
            <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-zinc-900 text-[11.5px] font-bold text-zinc-50">
              {pct}%
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function MiniStat({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[18px] font-bold text-zinc-50">{value}</div>
      <div className="text-[11px] text-zinc-400">{label}</div>
    </div>
  )
}

function AttentionSections({
  rejected,
  stalled,
  noEstimate
}: {
  rejected: Issue[]
  stalled: Issue[]
  noEstimate: Issue[]
}): React.JSX.Element {
  return (
    <div className="divide-y divide-red-900/40 light:divide-red-200">
      {rejected.length > 0 && (
        <AttentionGroup title={t.today.attentionRejected} issues={rejected} />
      )}
      {stalled.length > 0 && <AttentionGroup title={t.today.attentionStalled} issues={stalled} />}
      {noEstimate.length > 0 && (
        <AttentionGroup title={t.today.attentionNoEstimate} issues={noEstimate} />
      )}
    </div>
  )
}

function AttentionGroup({ title, issues }: { title: string; issues: Issue[] }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  return (
    <div className="px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-[.06em] text-red-300 uppercase light:text-red-700">
        {title}
        <span className="rounded-full bg-red-900/50 px-2 text-[11px] font-bold text-red-200 light:bg-red-200 light:text-red-800">
          {issues.length}
        </span>
      </div>
      <div className="flex flex-col">
        {issues.map((issue) => (
          <button
            key={issue.key}
            className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-red-900/20"
            onClick={() => openIssue(issue.key)}
            title={`Abrir ${issue.key}`}
          >
            <span className="shrink-0 font-mono text-[11.5px] text-zinc-500">{issue.key}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-200">
              {issue.summary}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function InProgressPanel({
  issues,
  stalledDays,
  todoInSprint,
  todoPoints,
  totalCount,
  totalPoints
}: {
  issues: Issue[]
  stalledDays: number
  todoInSprint: Issue[]
  todoPoints: number
  totalCount: number
  totalPoints: number
}): React.JSX.Element {
  return (
    // a hierarquia do painel primário vem do peso do título e do contador em
    // pílula de marca — a borda continua zinc-800, igual à dos outros cartões
    <Card
      className="min-w-0"
      title={
        <span className="flex items-center gap-2.5">
          <span className="text-[14.5px]">{t.today.inProgressTitle}</span>
          <Badge color="brand">{issues.length}</Badge>
        </span>
      }
      actions={<span className="text-xs text-zinc-500">{t.today.sortMostStalled}</span>}
      bodyClassName=""
    >
      <div className="flex flex-col gap-3 p-3">
        {issues.length === 0 ? (
          <p className="px-1.5 py-2 text-[13.5px] text-zinc-500">{t.today.emptyInProgress}</p>
        ) : (
          <IssuesByStatus issues={issues} variant="primary" stalledDays={stalledDays} />
        )}
        {todoInSprint.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-1 pb-0.5">
              <span className="text-[11px] font-bold tracking-[.06em] text-zinc-500 uppercase">
                {t.today.todoInSprint}
              </span>
              <span className="text-[11px] text-zinc-600">
                {todoInSprint.length} · {todoPoints} sp
              </span>
            </div>
            <div className="flex flex-col">
              {todoInSprint.map((issue) => (
                <TodoRow key={issue.key} issue={issue} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2.5 text-[12.5px] text-zinc-400">
        <Columns3 size={13} />
        <span>{t.today.footerTotal(totalCount, totalPoints)}</span>
        <Link to="/quadro" className="ml-auto font-semibold text-indigo-400 hover:underline">
          {t.today.openInBoard}
        </Link>
      </div>
    </Card>
  )
}

function TodoRow({ issue }: { issue: Issue }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  return (
    <button
      className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left transition-colors compact:py-1 hover:bg-zinc-800/40"
      onClick={() => openIssue(issue.key)}
      title={`Abrir ${issue.key}`}
    >
      <span className="shrink-0 font-mono text-[11.5px] text-zinc-600">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-400">{issue.summary}</span>
      {issue.storyPoints !== null ? (
        <Badge color="zinc">{issue.storyPoints}</Badge>
      ) : (
        <span className="rounded bg-zinc-800 px-1.5 text-xs text-zinc-600">—</span>
      )}
    </button>
  )
}

type ActivityKind = 'done' | 'moved' | 'commented'
type ActivityFilter = 'all' | ActivityKind
type ActivityEntry = { kind: ActivityKind; issue: Issue }

function ActivityCard({ period }: { period: Period }): React.JSX.Element {
  const { data: doneData } = useIssues(period, 'done')
  const { data: movedData } = useIssues(period, 'moved')
  const { data: commentedData } = useIssues(period, 'commented')
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const merged = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [
      ...(doneData?.issues ?? []).map((issue) => ({ kind: 'done' as const, issue })),
      ...(movedData?.issues ?? []).map((issue) => ({ kind: 'moved' as const, issue })),
      ...(commentedData?.issues ?? []).map((issue) => ({ kind: 'commented' as const, issue }))
    ]
    // mais recente primeiro — mesmo critério do handoff (resolvedAt ?? updatedAt)
    return entries.sort((a, b) => activityEntryTime(b) - activityEntryTime(a))
  }, [doneData, movedData, commentedData])

  const counts: Record<ActivityKind, number> = {
    done: doneData?.issues.length ?? 0,
    moved: movedData?.issues.length ?? 0,
    commented: commentedData?.issues.length ?? 0
  }
  const visible = filter === 'all' ? merged : merged.filter((e) => e.kind === filter)

  return (
    // os chips não cabem na faixa de título (que é uma linha só): ficam no topo
    // do corpo, fechados por uma borda própria
    <Card title={t.today.activityTitle} bodyClassName="">
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-800 px-3.5 py-2.5">
        <ActivityChip
          label={`${t.today.chipAll} ${merged.length}`}
          active={filter === 'all'}
          disabled={false}
          onClick={() => setFilter('all')}
        />
        <ActivityChip
          label={`${t.today.chipDone} ${counts.done}`}
          active={filter === 'done'}
          disabled={counts.done === 0}
          onClick={() => setFilter('done')}
        />
        <ActivityChip
          label={`${t.today.chipMoved} ${counts.moved}`}
          active={filter === 'moved'}
          disabled={counts.moved === 0}
          onClick={() => setFilter('moved')}
        />
        <ActivityChip
          label={`${t.today.chipCommented} ${counts.commented}`}
          active={filter === 'commented'}
          disabled={counts.commented === 0}
          onClick={() => setFilter('commented')}
        />
      </div>
      <div className="flex flex-col p-1.5">
        {visible.length === 0 && (
          <p className="px-2 py-3 text-[13px] text-zinc-500">{t.today.activityEmpty}</p>
        )}
        {visible.map((entry) => (
          <ActivityRow key={`${entry.kind}-${entry.issue.key}`} entry={entry} />
        ))}
      </div>
    </Card>
  )
}

function activityEntryTime(entry: ActivityEntry): number {
  const ref = entry.issue.resolvedAt ?? entry.issue.updatedAt
  return ref ? new Date(ref).getTime() : 0
}

const activityMeta: Record<
  ActivityKind,
  { icon: typeof CheckCircle2; color: string; verb: string }
> = {
  done: {
    icon: CheckCircle2,
    color: 'text-green-400 light:text-green-600',
    verb: t.today.chipDone
  },
  moved: {
    icon: ArrowRightLeft,
    color: 'text-blue-400 light:text-blue-600',
    verb: t.today.chipMoved
  },
  commented: {
    icon: MessageSquare,
    color: 'text-indigo-400',
    verb: t.today.chipCommented
  }
}

function ActivityRow({ entry }: { entry: ActivityEntry }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const meta = activityMeta[entry.kind]
  const Icon = meta.icon
  const reference = entry.issue.resolvedAt ?? entry.issue.updatedAt
  const timeLabel = reference ? format(new Date(reference), 'HH:mm') : null

  return (
    <button
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-zinc-800/60"
      onClick={() => openIssue(entry.issue.key)}
      title={`Abrir ${entry.issue.key}`}
    >
      <Icon size={14} className={`mt-0.5 shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-[1.45] text-zinc-200">
          {meta.verb} <span className="font-mono text-[11px] text-zinc-500">{entry.issue.key}</span>{' '}
          {entry.issue.summary}
        </div>
        <div className="text-[11px] text-zinc-600">
          {timeLabel}
          {entry.issue.storyPoints !== null ? ` · ${entry.issue.storyPoints} sp` : ''}
        </div>
      </div>
    </button>
  )
}

function ActivityChip({
  label,
  active,
  disabled,
  onClick
}: {
  label: string
  active: boolean
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  const styles = disabled
    ? 'border-zinc-800 text-zinc-600'
    : active
      ? 'border-indigo-600 bg-indigo-600 text-white'
      : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${styles}`}
    >
      {label}
    </button>
  )
}

function LeadTimeCard(): React.JSX.Element | null {
  const { data: leadTime } = useLeadTime()
  const statuses = leadTime?.statuses ?? []
  if (!leadTime || leadTime.cardCount === 0 || statuses.length === 0) return null

  const top = statuses.slice(0, 6)
  const max = Math.max(...top.map((s) => s.avgDays))

  return (
    <Card title={t.today.whereTimeGoes} bodyClassName="px-3.5 py-3">
      <p className="mb-2.5 text-[11px] text-zinc-500">
        {t.today.whereTimeGoesHint(leadTime.cardCount, leadTime.windowDays)}
      </p>
      <div className="flex flex-col gap-[7px]">
        {top.map((s) => (
          <div key={s.status} className="flex items-center gap-2">
            <div className="w-24 shrink-0 truncate text-[11.5px] text-zinc-200">{s.status}</div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-600"
                style={{ width: `${max > 0 ? (s.avgDays / max) * 100 : 0}%` }}
              />
            </div>
            <div className="w-[38px] shrink-0 text-right text-[11.5px] text-zinc-200">
              {formatDaysPtBr(s.avgDays)}d
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function formatDaysPtBr(value: number): string {
  return value.toFixed(1).replace('.', ',')
}
