import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  Sparkles
} from 'lucide-react'
import { standupReference, type Period } from '@shared/periods'
import type { Issue, SprintTrend, TeamMemberSummary } from '@shared/domain'
import { invoke, IpcError } from '../../api/client'
import { t } from '../../strings/ptBR'
import { useAiStatus, useTeam, useTrends, useVelocity } from '../../api/hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  SegmentedControl,
  Spinner
} from '../../components/ui'
import { statusColor } from '../../components/statusColor'
import { IssuesByStatus } from '../../components/IssuesByStatus'
import { VelocityChart } from '../../components/VelocityChart'
import { useIssueDetail } from '../../components/issueDetail'

type PeriodKey = 'today' | '7d' | 'sprint'

const periodOptions: Array<{ key: PeriodKey; label: string; period: Period }> = [
  { key: 'today', label: 'Hoje', period: { type: 'today' } },
  { key: '7d', label: '7 dias', period: { type: '7d' } },
  { key: 'sprint', label: 'Sprint', period: { type: 'sprint' } }
]

function isBlocked(issue: Issue): boolean {
  return issue.flagged || issue.priority === 'Highest' || issue.priority === 'Blocker'
}

export default function Team(): React.JSX.Element {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('7d')
  const period = periodOptions.find((p) => p.key === periodKey)!.period
  const { data, isLoading } = useTeam(period)
  const { data: velocity, isLoading: velocityLoading } = useVelocity()
  const { data: aiStatus } = useAiStatus()
  const aiLabel = aiStatus?.active?.label ?? 'IA'

  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeBusy, setNarrativeBusy] = useState(false)
  const [standup, setStandup] = useState(false)

  const generateNarrative = async (): Promise<void> => {
    setNarrativeBusy(true)
    try {
      const res = await invoke('team:narrative', { period })
      setNarrative(res.markdown)
    } finally {
      setNarrativeBusy(false)
    }
  }

  const members = data?.members ?? []
  // O contexto conta exatamente as linhas que a coluna renderiza — e no modo
  // standup quem renderiza é o StandupView, com outra query, outro período e a
  // lista de cada pessoa cortada em 3. Anunciar os números desta query ali
  // descreveria uma tela que não está na frente do usuário.
  const inPlay = members.reduce((sum, m) => sum + m.inProgress.length, 0)
  const context =
    data && !standup
      ? [
          data.periodLabel,
          `${members.length} pessoa${members.length === 1 ? '' : 's'}`,
          `${inPlay} card${inPlay === 1 ? '' : 's'} em andamento`
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Time"
        context={context}
        actions={
          <>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-[5px] text-[12.5px] font-semibold text-indigo-400 transition-colors hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:text-zinc-600"
              disabled={narrativeBusy || members.length === 0 || !aiStatus?.active}
              title={
                !aiStatus?.active
                  ? 'Nenhum provider de IA disponível — configure em Ajustes'
                  : undefined
              }
              onClick={() => void generateNarrative()}
            >
              {narrativeBusy ? <Spinner /> : <Sparkles size={13} />}
              {narrativeBusy ? 'Resumindo…' : 'Resumir time'}
            </button>
            <SegmentedControl
              aria-label="Período"
              options={periodOptions.map((p) => ({ value: p.key, label: p.label }))}
              value={periodKey}
              onChange={(next) => {
                setPeriodKey(next)
                setNarrative(null)
              }}
            />
            <button
              type="button"
              className={`rounded-md border px-3 py-[5px] text-[12.5px] transition-colors ${
                standup
                  ? 'border-indigo-600 bg-indigo-600/12 font-semibold text-indigo-400'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => setStandup((s) => !s)}
              title="Visão compacta pra acompanhar a daily (dados do último dia útil)"
            >
              Standup
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-[18px]">
        {data?.syncMode === 'personal' && (
          <div className="mb-3.5 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[12.5px] text-amber-200 light:border-amber-300 light:bg-amber-50 light:text-amber-800">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              O sync está em modo pessoal, então esta visão só mostra quem aparece no seu próprio
              trabalho. Para ver o time completo, troque para o modo projeto em Configurações.
            </span>
          </div>
        )}

        {standup ? (
          <StandupView />
        ) : (
          <div className="flex items-start gap-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-3.5">
              {narrative && (
                <Card
                  title={
                    <span className="flex items-center gap-2">
                      <Sparkles size={13} className="text-indigo-400" /> Panorama do time ({aiLabel}
                      )
                    </span>
                  }
                >
                  <p className="max-w-[70ch] text-[13px] leading-[1.65] whitespace-pre-wrap text-zinc-300">
                    {narrative}
                  </p>
                </Card>
              )}

              {isLoading && <Spinner className="text-zinc-500" />}
              {!isLoading && members.length === 0 && (
                <EmptyState message="Ninguém com atividade no período. Sincronize ou amplie o período." />
              )}

              {members.map((m) => (
                <MemberCard key={m.accountId} member={m} />
              ))}

              <TrendsCard />
            </div>

            <div className="flex w-[380px] shrink-0 flex-col gap-3.5">
              {(velocityLoading || (velocity && velocity.sprints.length > 0)) && (
                <Card title="Entregas por sprint">
                  {velocityLoading ? (
                    <Spinner className="text-zinc-500" />
                  ) : (
                    velocity && (
                      <>
                        <VelocityChart velocity={velocity} />
                        <p className="mt-2.5 text-[11.5px] leading-relaxed text-zinc-400">
                          No período:{' '}
                          <span className="font-bold text-zinc-200">
                            {velocity.totals.myPoints} SP
                          </span>{' '}
                          seus ·{' '}
                          <span className="font-bold text-zinc-200">
                            {velocity.totals.teamPoints} SP
                          </span>{' '}
                          do time · {velocity.totals.teamCount} cards
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-600">
                          últimas 8 sprints · pontos concluídos na janela de cada sprint
                        </p>
                      </>
                    )
                  )}
                </Card>
              )}

              <RiskRadar />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RiskRadar(): React.JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['sprint-risk'],
    queryFn: () => invoke('sprint:risk', {})
  })
  const { data: aiStatus } = useAiStatus()
  const aiLabel = aiStatus?.active?.label ?? 'IA'
  const [explain, setExplain] = useState<string | null>(null)
  const [explainBusy, setExplainBusy] = useState(false)
  const { openIssue } = useIssueDetail()

  const items = data?.items ?? []
  if (!data?.sprint || items.length === 0) return null

  const explainRisk = async (): Promise<void> => {
    setExplainBusy(true)
    try {
      const res = await invoke('sprint:riskExplain', {})
      setExplain(res.markdown)
    } finally {
      setExplainBusy(false)
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2.5">
          <AlertTriangle size={15} className="text-amber-400 light:text-amber-600" />
          Radar de risco
          <span className="text-[11.5px] font-normal text-zinc-500">{data.sprint.name}</span>
        </span>
      }
      bodyClassName="px-4 pt-0.5 pb-3"
    >
      <div className="flex flex-col">
        {items.map(({ issue, signals, score }) => (
          <button
            key={issue.key}
            className="flex w-full items-center gap-3 border-b border-zinc-800/60 py-2.5 text-left last:border-0"
            onClick={() => openIssue(issue.key)}
            title={`Abrir ${issue.key}`}
          >
            <span className="block min-w-0 flex-1">
              <span className="block truncate text-[13px] text-zinc-200">{issue.summary}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">
                <span className="font-mono">{issue.key}</span>
                {signals.length > 0 && (
                  <>
                    {' · '}
                    {/* score alto colore os sinais: é o que distingue risco de ruído */}
                    <span
                      className={
                        score >= 2 ? 'text-amber-400 light:text-amber-600' : 'text-zinc-500'
                      }
                    >
                      {signals.join(' · ')}
                    </span>
                  </>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Button
          variant="secondary"
          disabled={explainBusy || !aiStatus?.active}
          title={
            !aiStatus?.active
              ? 'Nenhum provider de IA disponível — configure em Ajustes'
              : undefined
          }
          onClick={() => void explainRisk()}
        >
          {explainBusy ? <Spinner /> : <Sparkles size={14} className="text-indigo-400" />}
          {explainBusy ? 'Analisando…' : `Explicar com ${aiLabel}`}
        </Button>
      </div>

      {explain && (
        <p className="mt-3 border-t border-zinc-800 pt-3 text-[13px] leading-[1.65] whitespace-pre-wrap text-zinc-300">
          {explain}
        </p>
      )}
    </Card>
  )
}

function formatLeadDays(days: number): string {
  return days.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function sparklinePoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const stepX = values.length > 1 ? w / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const x = values.length > 1 ? i * stepX : w / 2
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function Sparkline({ title, values }: { title: string; values: number[] }): React.JSX.Element {
  const W = 120
  const H = 28
  return (
    <div>
      <div className="mb-1 text-[11.5px] text-zinc-500">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="overflow-visible">
        <polyline
          points={sparklinePoints(values, W, H)}
          fill="none"
          stroke="var(--chart-accent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

/**
 * Tendências por sprint fechada — janela temporal da sprint (não associação
 * sprint_jira_id, infiel para histórico). Precisa de pelo menos 2 sprints
 * pra fazer sentido comparar.
 */
function TrendsCard(): React.JSX.Element | null {
  const { data, isLoading } = useTrends()
  const sprints: SprintTrend[] = data?.sprints ?? []

  // sem material para comparar não é cartão, é linha de ~26px (regra 3)
  if (!isLoading && sprints.length < 2) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-[12.5px] text-zinc-400">
        <span className="font-semibold text-zinc-200">Tendências</span>
        <span>poucas sprints fechadas para comparar</span>
      </div>
    )
  }

  return (
    <Card title="Tendências (últimas sprints)">
      {isLoading ? (
        <Spinner className="text-zinc-500" />
      ) : (
        <>
          <div className="mb-1 flex items-center gap-3 px-2 text-[11px] font-semibold tracking-[.04em] text-zinc-600 uppercase">
            <span className="min-w-0 flex-1">Sprint</span>
            <span className="w-16 text-right">SP</span>
            <span className="w-16 text-right">Cards</span>
            <span className="w-20 text-right">Lead</span>
            <span className="w-24 text-right">Criados</span>
          </div>
          <div className="flex flex-col">
            {sprints.map((s) => (
              <div
                key={s.jiraId}
                className="flex items-center gap-3 border-b border-zinc-800/60 px-2 py-2 text-[13px] text-zinc-300 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-zinc-200">
                  {s.name ?? `Sprint ${s.jiraId}`}
                </span>
                <span className="w-16 text-right tabular-nums">{s.deliveredSp} SP</span>
                <span className="w-16 text-right tabular-nums text-zinc-400">
                  {s.deliveredCount}
                </span>
                <span className="w-20 text-right tabular-nums text-zinc-400">
                  {s.avgLeadDays != null ? `${formatLeadDays(s.avgLeadDays)}d` : '—'}
                </span>
                <span className="w-24 text-right tabular-nums text-zinc-500">
                  {s.createdDuringCount}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-4 border-t border-zinc-800 pt-3">
            <Sparkline title="SP entregues" values={sprints.map((s) => s.deliveredSp)} />
            <Sparkline title="Lead médio (dias)" values={sprints.map((s) => s.avgLeadDays ?? 0)} />
            <Sparkline title="Criados durante" values={sprints.map((s) => s.createdDuringCount)} />
          </div>

          <p className="mt-3 text-[11.5px] text-zinc-500">
            Janela temporal por sprint fechada; lead = criação→resolução.
          </p>
        </>
      )}
    </Card>
  )
}

function StandupView(): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    // queryFn roda fora do render, então new Date() é permitido aqui
    queryFn: async () => {
      const ref = standupReference(new Date())
      const res = await invoke('team:summary', { period: ref.period })
      return { ...res, standupLabel: ref.label }
    },
    queryKey: ['team-standup']
  })

  const members = useMemo(() => {
    const list = data?.members ?? []
    return [...list].sort((a, b) => Number(b.isMe) - Number(a.isMe))
  }, [data])

  const label = data?.standupLabel ?? 'ontem'

  if (isLoading) return <Spinner className="text-zinc-500" />
  if (error) {
    return <EmptyState message={error instanceof IpcError ? error.message : t.common.error} />
  }
  if (members.length === 0) {
    return <EmptyState message={`Ninguém com atividade ${label}.`} />
  }

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-2">
      {members.map((m) => (
        <StandupCard key={m.accountId} member={m} label={label} />
      ))}
    </div>
  )
}

function StandupCard({
  member,
  label
}: {
  member: TeamMemberSummary
  label: string
}): React.JSX.Element {
  const shown = member.inProgress.slice(0, 3)
  const extra = member.inProgress.length - shown.length

  return (
    <Card
      title={
        <span className="flex items-center gap-2.5">
          <Avatar name={member.name} />
          {member.name}
          {member.isMe && <Badge color="indigo">você</Badge>}
        </span>
      }
    >
      <p className="mb-3 text-[11.5px] text-zinc-500">
        {label.charAt(0).toUpperCase() + label.slice(1)}: moveu {member.movedCount} · comentou{' '}
        {member.commentedCount}
      </p>

      {member.done.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-green-400 uppercase light:text-green-600">
            Concluiu
          </div>
          <div className="space-y-0.5">
            {member.done.map((i) => (
              <MiniIssue key={i.key} issueKey={i.key} summary={i.summary} trailing={null} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-2">
        <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-zinc-500 uppercase">
          Em andamento
        </div>
        {shown.length === 0 ? (
          <p className="text-[12.5px] text-zinc-600">Nada em andamento.</p>
        ) : (
          <div className="space-y-0.5">
            {shown.map((i) => (
              <MiniIssue key={i.key} issueKey={i.key} summary={i.summary} trailing={null} />
            ))}
            {extra > 0 && <p className="px-1.5 text-[12.5px] text-zinc-600">+{extra}</p>}
          </div>
        )}
      </div>

      {member.stalled.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-amber-400 uppercase light:text-amber-600">
            Atenção
          </div>
          <div className="space-y-0.5">
            {member.stalled.map((i) => (
              <MiniIssue
                key={i.key}
                issueKey={i.key}
                summary={i.summary}
                trailing={
                  <span className="text-[11.5px] text-amber-400 light:text-amber-600">
                    {i.stalledDays}d
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/** Iniciais em círculo de 34px — a âncora visual da linha de pessoa. */
function Avatar({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-indigo-900 text-[11.5px] font-bold text-indigo-400">
      {initials(name)}
    </span>
  )
}

function MemberStat({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <span className="block text-right">
      <span className="block text-[15px] leading-tight font-bold text-zinc-50 tabular-nums">
        {value}
      </span>
      <span className="block text-[10.5px] text-zinc-500">{label}</span>
    </span>
  )
}

/**
 * Pessoa é uma LINHA, não um cartão de conteúdo: os três números resolvem a
 * leitura de varredura. A lista de cards de cada um continua acessível, mas
 * atrás de um clique — senão cinco pessoas ocupam três telas de rolagem.
 */
function MemberCard({ member }: { member: TeamMemberSummary }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const blocked = member.inProgress.filter(isBlocked)
  const donePoints = member.done.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)

  const subtitleParts = [
    member.isMe ? 'você' : null,
    member.movedCount > 0 ? `${member.movedCount} movida(s)` : null,
    member.commentedCount > 0 ? `${member.commentedCount} comentada(s)` : null
  ].filter(Boolean)

  return (
    <Card bodyClassName="">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? 'Recolher os cards' : 'Ver os cards'}
      >
        <Avatar name={member.name} />
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-zinc-50">
            {member.name}
          </span>
          <span className="mt-px block truncate text-[11.5px] text-zinc-500">
            {subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'sem movimentações no período'}
          </span>
        </span>

        <span className="flex shrink-0 gap-3.5">
          <MemberStat value={member.inProgress.length} label="em andamento" />
          <MemberStat value={member.done.length} label="concluídas" />
          <MemberStat value={donePoints} label="sp" />
        </span>

        {blocked.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600/16 px-2.5 py-[3px] text-[11px] font-semibold text-red-400 light:text-red-600">
            <AlertTriangle size={11} />
            {blocked.length} bloqueado(s)
          </span>
        )}
        {member.stalled.length > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-600/16 px-2.5 py-[3px] text-[11px] font-semibold text-amber-400 light:text-amber-600">
            <AlertTriangle size={11} />
            {member.stalled.length} parado(s)
          </span>
        )}

        {open ? (
          <ChevronDown size={14} className="shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-zinc-600" />
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3.5 py-3">
          {blocked.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-[.04em] text-red-400 uppercase light:text-red-600">
                <AlertTriangle size={12} /> Bloqueado
              </div>
              <IssueList issues={blocked} />
            </div>
          )}

          {member.stalled.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-amber-400 uppercase light:text-amber-600">
                Parado
              </div>
              <div className="space-y-0.5">
                {member.stalled.map((i) => (
                  <MiniIssue
                    key={i.key}
                    issueKey={i.key}
                    summary={i.summary}
                    trailing={
                      <span className="text-[11.5px] text-amber-400 light:text-amber-600">
                        {i.stalledDays}d
                      </span>
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-zinc-500 uppercase">
              Em andamento
            </div>
            {member.inProgress.length === 0 ? (
              <p className="text-[12.5px] text-zinc-600">Nada em andamento.</p>
            ) : (
              <IssuesByStatus issues={member.inProgress} />
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function IssueList({ issues }: { issues: Issue[] }): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      {issues.map((i) => (
        <MiniIssue
          key={i.key}
          issueKey={i.key}
          summary={i.summary}
          trailing={
            i.status ? <Badge color={statusColor(i.statusCategory)}>{i.status}</Badge> : null
          }
        />
      ))}
    </div>
  )
}

function MiniIssue({
  issueKey,
  summary,
  trailing
}: {
  issueKey: string
  summary: string
  trailing: React.ReactNode
}): React.JSX.Element {
  const { openIssue } = useIssueDetail()

  return (
    <button
      className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-zinc-800/70"
      onClick={() => openIssue(issueKey)}
      title={`Abrir ${issueKey}`}
    >
      <span className="shrink-0 font-mono text-[11px] text-zinc-500">{issueKey}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">{summary}</span>
      {trailing}
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${issueKey} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey })
        }}
      >
        <ExternalLink size={12} />
      </span>
    </button>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
