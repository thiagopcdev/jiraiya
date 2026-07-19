import { useMemo, useState } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowRightLeft,
  CheckCircle2,
  ExternalLink,
  Flag,
  MessageSquare,
  Plus,
  Ruler,
  UserRound,
  Zap
} from 'lucide-react'
import type { Period } from '@shared/periods'
import type { ActivityKind, IssueActivity } from '@shared/domain'
import { useProjects, useTimeline } from '../../api/hooks'
import { invoke } from '../../api/client'
import { EmptyState, Spinner } from '../../components/ui'
import { useIssueDetail } from '../../components/issueDetail'

const periodOptions: Array<{ key: string; label: string; period: Period }> = [
  { key: 'today', label: 'Hoje', period: { type: 'today' } },
  { key: '7d', label: '7 dias', period: { type: '7d' } },
  { key: '30d', label: '30 dias', period: { type: '30d' } },
  { key: 'sprint', label: 'Sprint', period: { type: 'sprint' } }
]

const kindMeta: Record<ActivityKind, { icon: typeof Zap; label: string; color: string }> = {
  created: { icon: Plus, label: 'criou', color: 'text-zinc-400' },
  status_change: { icon: ArrowRightLeft, label: 'moveu', color: 'text-blue-400' },
  resolved: { icon: CheckCircle2, label: 'resolveu', color: 'text-green-400' },
  assignment: { icon: UserRound, label: 'atribuiu', color: 'text-amber-400' },
  comment: { icon: MessageSquare, label: 'comentou', color: 'text-indigo-400' },
  sprint_change: { icon: Zap, label: 'mudou sprint', color: 'text-purple-400' },
  priority_change: { icon: Flag, label: 'mudou prioridade', color: 'text-red-400' },
  estimate_change: { icon: Ruler, label: 'estimou', color: 'text-teal-400' }
}

export default function Timeline(): React.JSX.Element {
  const [periodKey, setPeriodKey] = useState('7d')
  const [onlyMine, setOnlyMine] = useState(true)
  const [projectKey, setProjectKey] = useState<string>('')
  const period = periodOptions.find((p) => p.key === periodKey)!.period

  const { data, isLoading } = useTimeline(period, onlyMine, projectKey || undefined)
  const { data: projectsData } = useProjects()
  const selectedProjects = (projectsData?.projects ?? []).filter((p) => p.selected)

  const groups = useMemo(() => groupByDay(data?.activities ?? []), [data])

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-semibold text-zinc-100">Timeline</h2>
        <select
          className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300"
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value)}
        >
          <option value="">Todos os projetos</option>
          {selectedProjects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
          />
          Somente minhas ações
        </label>
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {periodOptions.map((p) => (
            <button
              key={p.key}
              className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                periodKey === p.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setPeriodKey(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && groups.length === 0 && (
        <EmptyState message="Nenhuma atividade no período selecionado." />
      )}

      <div className="space-y-6">
        {groups.map(({ day, items }) => (
          <section key={day}>
            <h3 className="mb-2 text-sm font-semibold text-zinc-400">{dayLabel(day)}</h3>
            <div className="space-y-0.5 border-l border-zinc-800 pl-4">
              {items.map((a) => (
                <ActivityRow key={a.id} activity={a} showActor={!onlyMine} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ActivityRow({
  activity,
  showActor
}: {
  activity: IssueActivity
  showActor: boolean
}): React.JSX.Element {
  const meta = kindMeta[activity.kind]
  const Icon = meta.icon
  const { openIssue } = useIssueDetail()
  return (
    <button
      className="group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/60"
      onClick={() => openIssue(activity.issueKey)}
      title={activity.issueKey}
    >
      <Icon size={15} className={`mt-0.5 shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          {showActor && (
            <span className="font-medium text-zinc-300">{activity.actorName ?? '?'}</span>
          )}
          <span className="text-zinc-400">{meta.label}</span>
          <span className="font-mono text-xs text-zinc-500">{activity.issueKey}</span>
          {activity.kind === 'status_change' && (
            <span className="text-zinc-400">
              {activity.fromValue} → <span className="text-zinc-200">{activity.toValue}</span>
            </span>
          )}
          {activity.kind === 'assignment' && (
            <span className="text-zinc-400">para {activity.toValue ?? 'ninguém'}</span>
          )}
          {(activity.kind === 'priority_change' || activity.kind === 'estimate_change') && (
            <span className="text-zinc-400">
              {activity.fromValue ?? '—'} → {activity.toValue ?? '—'}
            </span>
          )}
        </div>
        {activity.issueSummary && (
          <div className="truncate text-xs text-zinc-500">{activity.issueSummary}</div>
        )}
        {activity.kind === 'comment' && activity.bodyText && (
          <div className="mt-1 line-clamp-2 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
            {activity.bodyText}
          </div>
        )}
      </div>
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${activity.issueKey} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey: activity.issueKey })
        }}
      >
        <ExternalLink size={13} />
      </span>
      <span className="shrink-0 text-xs text-zinc-600">
        {format(new Date(activity.occurredAt), 'HH:mm')}
      </span>
    </button>
  )
}

function groupByDay(activities: IssueActivity[]): Array<{ day: string; items: IssueActivity[] }> {
  const map = new Map<string, IssueActivity[]>()
  for (const a of activities) {
    const day = format(new Date(a.occurredAt), 'yyyy-MM-dd')
    const list = map.get(day) ?? []
    list.push(a)
    map.set(day, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, items]) => ({ day, items }))
}

function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`)
  if (isToday(date)) return 'Hoje'
  if (isYesterday(date)) return 'Ontem'
  return format(date, "EEEE, d 'de' MMMM", { locale: ptBR })
}
