import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Info, Sparkles } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { Issue, TeamMemberSummary } from '@shared/domain'
import { invoke } from '../../api/client'
import { useTeam, useVelocity } from '../../api/hooks'
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui'
import { statusColor } from '../../components/statusColor'
import { IssuesByStatus } from '../../components/IssuesByStatus'
import { VelocityChart } from '../../components/VelocityChart'
import { useIssueDetail } from '../../components/issueDetail'

const periodOptions: Array<{ key: string; label: string; period: Period }> = [
  { key: 'today', label: 'Hoje', period: { type: 'today' } },
  { key: '7d', label: '7 dias', period: { type: '7d' } },
  { key: 'sprint', label: 'Sprint', period: { type: 'sprint' } }
]

function isBlocked(issue: Issue): boolean {
  return issue.flagged || issue.priority === 'Highest' || issue.priority === 'Blocker'
}

export default function Team(): React.JSX.Element {
  const [periodKey, setPeriodKey] = useState('7d')
  const period = periodOptions.find((p) => p.key === periodKey)!.period
  const { data, isLoading } = useTeam(period)
  const { data: velocity, isLoading: velocityLoading } = useVelocity()

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

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-semibold text-zinc-100">Time</h2>
        <Button
          variant="secondary"
          disabled={narrativeBusy || members.length === 0}
          onClick={() => void generateNarrative()}
        >
          {narrativeBusy ? (
            <Spinner />
          ) : (
            <Sparkles size={14} className="text-indigo-400 light:text-indigo-600" />
          )}
          {narrativeBusy ? 'Resumindo…' : 'Resumir time'}
        </Button>
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {periodOptions.map((p) => (
            <button
              key={p.key}
              className={`rounded-md px-2.5 py-1 text-sm font-medium ${
                periodKey === p.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              onClick={() => {
                setPeriodKey(p.key)
                setNarrative(null)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          className={`rounded-md border px-2.5 py-1 text-sm font-medium transition-colors ${
            standup
              ? 'border-indigo-600 bg-indigo-950/60 text-indigo-200 light:bg-indigo-50 light:text-indigo-700'
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
          }`}
          onClick={() => setStandup((s) => !s)}
          title="Visão compacta pra acompanhar a daily (dados de ontem)"
        >
          Standup
        </button>
      </div>

      {data?.syncMode === 'personal' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 light:border-amber-300 light:bg-amber-50 light:text-amber-800">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            O sync está em modo pessoal, então esta visão só mostra quem aparece no seu próprio
            trabalho. Para ver o time completo, troque para o modo projeto em Configurações.
          </span>
        </div>
      )}

      {(velocityLoading || (velocity && velocity.sprints.length > 0)) && (
        <Card
          title={
            <span>
              Entregas por sprint
              <span className="ml-2 font-normal text-zinc-500">
                últimas 8 sprints · pontos concluídos na janela de cada sprint
              </span>
            </span>
          }
          className="mb-4"
        >
          {velocityLoading ? (
            <Spinner className="text-zinc-500" />
          ) : (
            velocity && (
              <>
                <VelocityChart velocity={velocity} />
                <p className="mt-2 text-xs text-zinc-400">
                  No período: {velocity.totals.myPoints} SP seus · {velocity.totals.teamPoints} SP
                  do time · {velocity.totals.teamCount} cards
                </p>
              </>
            )
          )}
        </Card>
      )}

      <RiskRadar />

      {narrative && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={13} className="text-indigo-400 light:text-indigo-600" /> Panorama do
              time (Claude)
            </span>
          }
          className="mb-4"
        >
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300">{narrative}</pre>
        </Card>
      )}

      {standup ? (
        <StandupView />
      ) : (
        <>
          {isLoading && <Spinner className="text-zinc-500" />}
          {!isLoading && members.length === 0 && (
            <EmptyState message="Ninguém com atividade no período. Sincronize ou amplie o período." />
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {members.map((m) => (
              <MemberCard key={m.accountId} member={m} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RiskRadar(): React.JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['sprint-risk'],
    queryFn: () => invoke('sprint:risk', {})
  })
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
        <span className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400 light:text-amber-600" /> Radar de risco
          <span className="font-normal text-zinc-500">{data.sprint.name}</span>
        </span>
      }
      className="mb-4"
    >
      <div className="space-y-1">
        {items.map(({ issue, signals, score }) => (
          <button
            key={issue.key}
            className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800/70 ${
              score >= 2 ? 'border-l-2 border-amber-500 pl-1.5' : ''
            }`}
            onClick={() => openIssue(issue.key)}
            title={`Abrir ${issue.key}`}
          >
            <span className="shrink-0 font-mono text-xs text-zinc-500">{issue.key}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{issue.summary}</span>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {signals.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-amber-950/60 px-2 text-xs whitespace-nowrap text-amber-300 light:bg-amber-100 light:text-amber-700"
                >
                  {s}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Button variant="secondary" disabled={explainBusy} onClick={() => void explainRisk()}>
          {explainBusy ? (
            <Spinner />
          ) : (
            <Sparkles size={14} className="text-indigo-400 light:text-indigo-600" />
          )}
          {explainBusy ? 'Analisando…' : 'Explicar com Claude'}
        </Button>
      </div>

      {explain && (
        <pre className="mt-3 border-t border-zinc-800 pt-3 whitespace-pre-wrap font-sans text-sm text-zinc-300">
          {explain}
        </pre>
      )}
    </Card>
  )
}

function StandupView(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['team-standup'],
    queryFn: () => invoke('team:summary', { period: { type: 'yesterday' } })
  })

  const members = useMemo(() => {
    const list = data?.members ?? []
    return [...list].sort((a, b) => Number(b.isMe) - Number(a.isMe))
  }, [data])

  if (isLoading) return <Spinner className="text-zinc-500" />
  if (members.length === 0) {
    return <EmptyState message="Ninguém com atividade ontem." />
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {members.map((m) => (
        <StandupCard key={m.accountId} member={m} />
      ))}
    </div>
  )
}

function StandupCard({ member }: { member: TeamMemberSummary }): React.JSX.Element {
  const shown = member.inProgress.slice(0, 3)
  const extra = member.inProgress.length - shown.length

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-zinc-200">
            {initials(member.name)}
          </span>
          {member.name}
          {member.isMe && <Badge color="indigo">você</Badge>}
        </span>
      }
    >
      <p className="mb-3 text-xs text-zinc-400">
        Ontem: moveu {member.movedCount} · comentou {member.commentedCount}
      </p>

      {member.done.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-semibold text-green-400 light:text-green-600">
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
        <div className="mb-1 text-xs font-semibold text-zinc-400">Em andamento</div>
        {shown.length === 0 ? (
          <p className="text-xs text-zinc-600">Nada em andamento.</p>
        ) : (
          <div className="space-y-0.5">
            {shown.map((i) => (
              <MiniIssue key={i.key} issueKey={i.key} summary={i.summary} trailing={null} />
            ))}
            {extra > 0 && <p className="px-1.5 text-xs text-zinc-600">+{extra}</p>}
          </div>
        )}
      </div>

      {member.stalled.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-amber-400 light:text-amber-600">
            Atenção
          </div>
          <div className="space-y-0.5">
            {member.stalled.map((i) => (
              <MiniIssue
                key={i.key}
                issueKey={i.key}
                summary={i.summary}
                trailing={
                  <span className="text-xs text-amber-500 light:text-amber-700">
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

function MemberCard({ member }: { member: TeamMemberSummary }): React.JSX.Element {
  const blocked = member.inProgress.filter(isBlocked)
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-zinc-200">
            {initials(member.name)}
          </span>
          {member.name}
          {member.isMe && <Badge color="indigo">você</Badge>}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2 text-xs text-zinc-400">
        <span>{member.inProgress.length} em andamento</span>
        <span aria-hidden>·</span>
        <span>{member.done.length} concluída(s)</span>
        {member.movedCount > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{member.movedCount} movida(s)</span>
          </>
        )}
        {member.commentedCount > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{member.commentedCount} comentada(s)</span>
          </>
        )}
      </div>

      {blocked.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-400 light:text-red-600">
            <AlertTriangle size={12} /> Bloqueado
          </div>
          <IssueList issues={blocked} />
        </div>
      )}

      {member.stalled.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-semibold text-amber-400 light:text-amber-600">
            Parado
          </div>
          <div className="space-y-0.5">
            {member.stalled.map((i) => (
              <MiniIssue
                key={i.key}
                issueKey={i.key}
                summary={i.summary}
                trailing={
                  <span className="text-xs text-amber-500 light:text-amber-700">
                    {i.stalledDays}d
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-semibold text-zinc-400">Em andamento</div>
        {member.inProgress.length === 0 ? (
          <p className="text-xs text-zinc-600">Nada em andamento.</p>
        ) : (
          <IssuesByStatus issues={member.inProgress} />
        )}
      </div>
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
      className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-800/70"
      onClick={() => openIssue(issueKey)}
      title={`Abrir ${issueKey}`}
    >
      <span className="shrink-0 font-mono text-xs text-zinc-500">{issueKey}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{summary}</span>
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
