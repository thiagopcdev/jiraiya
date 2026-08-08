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
import {
  Badge,
  Card,
  EmptyState,
  ScreenHeader,
  SegmentedControl,
  Spinner,
  Toggle
} from '../../components/ui'
import { PairTabs } from '../../components/PairTabs'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'

/**
 * Faixa de abas do par "Filtros · Timeline" (item único na sidebar, handoff Tela C).
 * Navegação de verdade — não estado local: a aba ativa é a rota atual.
 */
const periodOptions: Array<{ value: string; label: string; period: Period }> = [
  { value: 'today', label: 'Hoje', period: { type: 'today' } },
  { value: '7d', label: '7 dias', period: { type: '7d' } },
  { value: '30d', label: '30 dias', period: { type: '30d' } },
  { value: 'sprint', label: 'Sprint', period: { type: 'sprint' } }
]

/**
 * Cor por tipo de evento. `sprint_change` e `estimate_change` compartilham o
 * teal: o roxo antigo brigava com o azul de marca das chaves de card.
 */
const kindMeta: Record<ActivityKind, { icon: typeof Zap; label: string; color: string }> = {
  created: { icon: Plus, label: 'criou', color: 'text-zinc-400' },
  status_change: {
    icon: ArrowRightLeft,
    label: 'moveu',
    color: 'text-blue-400 light:text-blue-600'
  },
  resolved: {
    icon: CheckCircle2,
    label: 'resolveu',
    color: 'text-green-400 light:text-green-600'
  },
  assignment: {
    icon: UserRound,
    label: 'atribuiu',
    color: 'text-amber-400 light:text-amber-600'
  },
  comment: {
    icon: MessageSquare,
    label: 'comentou',
    color: 'text-indigo-400 light:text-indigo-600'
  },
  sprint_change: {
    icon: Zap,
    label: 'mudou sprint',
    color: 'text-teal-400 light:text-teal-600'
  },
  priority_change: {
    icon: Flag,
    label: 'mudou prioridade',
    color: 'text-red-400 light:text-red-600'
  },
  estimate_change: { icon: Ruler, label: 'estimou', color: 'text-teal-400 light:text-teal-600' }
}

export default function Timeline(): React.JSX.Element {
  const [periodKey, setPeriodKey] = useState('7d')
  const [onlyMine, setOnlyMine] = useState(true)
  const [projectKey, setProjectKey] = useState<string>('')
  const period = periodOptions.find((p) => p.value === periodKey)!.period

  const { data, isLoading } = useTimeline(period, onlyMine, projectKey || undefined)
  const { data: projectsData } = useProjects()
  const selectedProjects = (projectsData?.projects ?? []).filter((p) => p.selected)

  const groups = useMemo(() => groupByDay(data?.activities ?? []), [data])

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.nav.filtersTimeline} flush />
      <PairTabs
        tabs={[
          { to: '/filtros', label: t.nav.filters },
          { to: '/timeline', label: t.nav.timeline }
        ]}
      />
      {/* barra de filtro da tela: fica abaixo das abas porque é controle de
          conteúdo, não navegação (as abas trocam de rota) */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800 bg-zinc-950/60 px-6 py-2.5">
        <select
          aria-label="Projeto"
          className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200"
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
        <Toggle checked={onlyMine} onChange={setOnlyMine} aria-labelledby="timeline-only-mine" />
        <span id="timeline-only-mine" className="text-[12.5px] text-zinc-200">
          só meus cards
        </span>
        <SegmentedControl
          className="ml-auto"
          aria-label="Período"
          options={periodOptions.map((p) => ({ value: p.value, label: p.label }))}
          value={periodKey}
          onChange={setPeriodKey}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-[18px_24px]">
        {isLoading && <Spinner className="text-zinc-500" />}
        {!isLoading && groups.length === 0 && (
          <EmptyState message="Nenhuma atividade no período selecionado." />
        )}

        <div className="flex max-w-[900px] flex-col gap-3.5">
          {groups.map(({ day, items }) => (
            <Card
              key={day}
              title={
                <span className="flex items-center gap-2.5">
                  {dayLabel(day)}
                  <Badge color={isDayToday(day) ? 'brand' : 'zinc'}>{items.length}</Badge>
                </span>
              }
              bodyClassName="px-4 py-0.5"
            >
              {items.map((a) => (
                <ActivityRow key={a.id} activity={a} showActor={!onlyMine} />
              ))}
            </Card>
          ))}
        </div>
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
  const { trailing, detail } = activityText(activity)
  const { openIssue } = useIssueDetail()
  return (
    <button
      className="group flex w-full items-start gap-2.5 border-b border-zinc-800/60 py-2 text-left transition-colors last:border-0 hover:bg-zinc-800/40"
      onClick={() => openIssue(activity.issueKey)}
      title={activity.issueKey}
    >
      <Icon size={14} className={`mt-0.5 shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        {/* uma linha só: quem, o verbo, a chave e o complemento */}
        <div className="truncate text-[13px] text-zinc-200">
          {showActor && (
            <span className="font-semibold text-zinc-50">{activity.actorName ?? '?'} </span>
          )}
          {meta.label}{' '}
          <span className="font-mono text-[11.5px] text-indigo-400">{activity.issueKey}</span>
          {trailing && ` ${trailing}`}
        </div>
        {detail && <div className="mt-0.5 truncate text-[11.5px] text-zinc-500">{detail}</div>}
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
      <span className="shrink-0 text-[11.5px] text-zinc-600">
        {format(new Date(activity.occurredAt), 'HH:mm')}
      </span>
    </button>
  )
}

/**
 * Divide o texto do evento entre o fim da linha principal (`trailing`) e a
 * linha de detalhe. O resumo do card cai no detalhe quando o complemento já
 * ocupou a linha principal — assim nada some, mas a linha continua sendo uma só.
 */
function activityText(a: IssueActivity): { trailing: string | null; detail: string | null } {
  const summary = a.issueSummary ?? null
  switch (a.kind) {
    case 'status_change':
      return {
        trailing: a.toValue ? `para ${a.toValue}` : null,
        detail:
          [a.fromValue ? `de ${a.fromValue}` : null, summary].filter(Boolean).join(' · ') || null
      }
    case 'assignment':
      return { trailing: `para ${a.toValue ?? 'ninguém'}`, detail: summary }
    case 'comment':
      return { trailing: null, detail: a.bodyText ? `“${a.bodyText}”` : summary }
    case 'sprint_change':
    case 'priority_change':
    case 'estimate_change':
      return { trailing: summary, detail: `${a.fromValue ?? '—'} → ${a.toValue ?? '—'}` }
    default:
      return { trailing: summary, detail: null }
  }
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

/** meio-dia para não escorregar de dia por fuso na conversão */
function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00`)
}

function isDayToday(day: string): boolean {
  return isToday(dayDate(day))
}

function dayLabel(day: string): string {
  const date = dayDate(day)
  if (isToday(date)) return 'Hoje'
  if (isYesterday(date)) return 'Ontem'
  return format(date, "EEEE, d 'de' MMMM", { locale: ptBR })
}
