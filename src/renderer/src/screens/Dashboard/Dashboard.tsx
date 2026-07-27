import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { differenceInCalendarDays } from 'date-fns'
import { AlertTriangle, FileText, X } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { Issue } from '@shared/domain'
import { invoke } from '../../api/client'
import { useIssues, useLeadTime } from '../../api/hooks'
import { computeBurndown } from '../../lib/burndown'
import { BurndownChart } from '../../components/BurndownChart'
import { Card, EmptyState, Spinner } from '../../components/ui'
import { IssueRow } from '../../components/IssueRow'
import { IssuesByStatus } from '../../components/IssuesByStatus'

const tabs: Array<{ key: string; label: string; period: Period }> = [
  { key: 'today', label: 'Hoje', period: { type: 'today' } },
  { key: '7d', label: 'Últimos 7 dias', period: { type: '7d' } },
  { key: 'sprint', label: 'Sprint atual', period: { type: 'sprint' } }
]

const buckets: Array<{
  key: 'moved' | 'commented' | 'done' | 'inProgress' | 'stalled'
  title: string
  empty: string
}> = [
  { key: 'done', title: 'Concluí', empty: 'Nenhuma issue concluída no período.' },
  { key: 'moved', title: 'Movi', empty: 'Nenhuma mudança de status sua no período.' },
  { key: 'commented', title: 'Comentei', empty: 'Nenhum comentário seu no período.' },
  { key: 'inProgress', title: 'Em andamento', empty: 'Nada em andamento atribuído a você.' },
  { key: 'stalled', title: 'Parados', empty: 'Nenhum ticket parado.' }
]

export default function Dashboard(): React.JSX.Element {
  const [tab, setTab] = useState(tabs[0])

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-100">Dashboard</h2>
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {tabs.map((item) => (
            <button
              key={item.key}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tab.key === item.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setTab(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <BriefingBanner />

      {tab.key === 'sprint' && <SprintHeader />}

      <RejectedBanner />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {buckets.map((b) => (
          <BucketCard
            key={b.key}
            bucket={b.key}
            title={b.title}
            empty={b.empty}
            period={tab.period}
          />
        ))}
        <LeadTimeCard />
      </div>
    </div>
  )
}

// dispensa persistida por id do resumo: sobrevive à navegação/reinício e o
// banner volta sozinho no dia seguinte (novo resumo = novo id)
const DISMISSED_BRIEFING_KEY = 'jiraiya.dismissedBriefingId'

function BriefingBanner(): React.JSX.Element | null {
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

  const dismiss = (): void => {
    localStorage.setItem(DISMISSED_BRIEFING_KEY, String(data.summaryId))
    setDismissedId(data.summaryId)
  }

  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
      <FileText size={15} className="shrink-0 text-indigo-400 light:text-indigo-600" />
      <span className="flex-1">Sua daily de hoje está pronta.</span>
      <button
        className="rounded-md px-2 py-1 text-sm font-medium text-indigo-400 hover:bg-zinc-800 light:text-indigo-600"
        onClick={() => void navigate('/resumos')}
      >
        Ver
      </button>
      <button
        className="shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
        title="Dispensar"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </div>
  )
}

function LeadTimeCard(): React.JSX.Element | null {
  const { data: leadTime } = useLeadTime()
  const statuses = leadTime?.statuses ?? []
  if (!leadTime || leadTime.cardCount === 0 || statuses.length === 0) return null

  const top = statuses.slice(0, 6)
  const max = Math.max(...top.map((s) => s.avgDays))

  return (
    <Card
      className="xl:col-span-2"
      title={
        <div>
          <div>Onde seu tempo passa</div>
          <div className="text-xs font-normal text-zinc-500">
            média por status dos seus últimos {leadTime.cardCount} cards concluídos (
            {leadTime.windowDays} dias)
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        {top.map((s) => (
          <div key={s.status} className="flex items-center gap-3">
            <div className="w-32 shrink-0 truncate text-sm text-zinc-300">{s.status}</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-900/60 light:bg-indigo-500"
                style={{ width: `${max > 0 ? (s.avgDays / max) * 100 : 0}%` }}
              />
            </div>
            <div className="w-24 shrink-0 text-right text-sm text-zinc-300">
              {formatDaysPtBr(s.avgDays)} d{' '}
              <span className="text-zinc-600">({s.samples} cards)</span>
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

function BucketCard({
  bucket,
  title,
  empty,
  period
}: {
  bucket: 'moved' | 'commented' | 'done' | 'inProgress' | 'stalled'
  title: string
  empty: string
  period: Period
}): React.JSX.Element {
  const { data, isLoading } = useIssues(period, bucket)
  const issues = data?.issues ?? []
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {title}
          <span className="rounded bg-zinc-800 px-1.5 text-xs text-zinc-400">{issues.length}</span>
        </span>
      }
    >
      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && issues.length === 0 && <EmptyState message={empty} />}
      {issues.length > 0 && (
        <div className="max-h-64 overflow-y-auto">
          {bucket === 'inProgress' ? (
            <IssuesByStatus issues={issues} />
          ) : (
            <div className="space-y-0.5">
              {issues.map((i: Issue) => (
                <IssueRow key={i.key} issue={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function RejectedBanner(): React.JSX.Element {
  // estado atual (independe da aba de período): meus cards reprovados.
  // Sempre visível — mostra "0" quando não há nenhum, pra ser fácil de achar.
  const { data, isLoading } = useIssues({ type: '7d' }, 'rejected')
  const issues = data?.issues ?? []
  const has = issues.length > 0
  return (
    <Card
      className={`mb-4 ${has ? 'border-red-900/50 bg-red-950/20 light:border-red-300 light:bg-red-50' : ''}`}
      title={
        <span
          className={`flex items-center gap-2 ${has ? 'text-red-300 light:text-red-700' : 'text-zinc-300'}`}
        >
          <AlertTriangle size={15} className={has ? '' : 'text-zinc-500'} />
          Reprovados
          <span
            className={`rounded px-1.5 text-xs ${has ? 'bg-red-900/50 light:bg-red-200' : 'bg-zinc-800 text-zinc-400'}`}
          >
            {issues.length}
          </span>
        </span>
      }
    >
      {isLoading ? (
        <Spinner className="text-zinc-500" />
      ) : has ? (
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {issues.map((i) => (
            <IssueRow key={i.key} issue={i} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Nenhum card seu reprovado no momento.</p>
      )}
    </Card>
  )
}

function SprintHeader(): React.JSX.Element {
  const { data } = useIssues({ type: 'sprint' }, 'sprintScope')
  const { data: sprintData } = useQuery({
    queryKey: ['sprint-active'],
    queryFn: () => invoke('sprint:active', {})
  })
  const sprint = sprintData?.sprint ?? null
  const issues = useMemo(() => data?.issues ?? [], [data])
  const done = issues.filter((i) => i.statusCategory === 'done').length
  const open = issues.length - done
  const daysLeft = sprint?.endDate
    ? differenceInCalendarDays(new Date(sprint.endDate), new Date())
    : null

  const burndown = useMemo(
    () =>
      sprint?.startDate && sprint.endDate
        ? computeBurndown(issues, sprint.startDate, sprint.endDate)
        : null,
    [issues, sprint]
  )

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
      <div className="flex items-center gap-6">
        <div>
          <div className="text-sm font-semibold text-zinc-100">
            {sprint?.name ?? 'Sem sprint ativa'}
          </div>
          {daysLeft !== null && (
            <div
              className={`text-xs ${daysLeft <= 2 ? 'text-amber-400 light:text-amber-600' : 'text-zinc-500'}`}
            >
              {daysLeft < 0
                ? 'encerrada'
                : daysLeft === 0
                  ? 'termina hoje'
                  : `termina em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`}
            </div>
          )}
        </div>
        <Stat label="Na sprint" value={issues.length} />
        <Stat label="Concluídas" value={done} />
        <Stat label="Abertas" value={open} />
        {issues.length > 0 && (
          <div className="ml-auto text-xs text-zinc-500">
            {Math.round((done / issues.length) * 100)}% concluído
          </div>
        )}
      </div>
      {burndown && sprint?.startDate && sprint.endDate && burndown.scope > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <BurndownChart
            burndown={burndown}
            sprintStart={sprint.startDate}
            sprintEnd={sprint.endDate}
          />
          {burndown.unestimatedCount > 0 && (
            <p className="mt-1 text-xs text-zinc-600">
              {burndown.unestimatedCount} issue{burndown.unestimatedCount === 1 ? '' : 's'} sem
              estimativa fora do gráfico
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div>
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}
