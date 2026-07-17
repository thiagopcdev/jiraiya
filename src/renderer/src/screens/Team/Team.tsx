import { useState } from 'react'
import { AlertTriangle, Info, Sparkles } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { Issue, TeamMemberSummary } from '@shared/domain'
import { invoke } from '../../api/client'
import { useTeam } from '../../api/hooks'
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui'
import { statusColor } from '../../components/statusColor'
import { IssuesByStatus } from '../../components/IssuesByStatus'

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

  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeBusy, setNarrativeBusy] = useState(false)

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
          {narrativeBusy ? <Spinner /> : <Sparkles size={14} className="text-indigo-400" />}
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
      </div>

      {data?.syncMode === 'personal' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <Info size={15} className="mt-0.5 shrink-0" />
          <span>
            O sync está em modo pessoal, então esta visão só mostra quem aparece no seu próprio
            trabalho. Para ver o time completo, troque para o modo projeto em Configurações.
          </span>
        </div>
      )}

      {narrative && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={13} className="text-indigo-400" /> Panorama do time (Claude)
            </span>
          }
          className="mb-4"
        >
          <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-300">{narrative}</pre>
        </Card>
      )}

      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && members.length === 0 && (
        <EmptyState message="Ninguém com atividade no período. Sincronize ou amplie o período." />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {members.map((m) => (
          <MemberCard key={m.accountId} member={m} />
        ))}
      </div>
    </div>
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
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-400">
            <AlertTriangle size={12} /> Bloqueado
          </div>
          <IssueList issues={blocked} />
        </div>
      )}

      {member.stalled.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-semibold text-amber-400">Parado</div>
          <div className="space-y-0.5">
            {member.stalled.map((i) => (
              <MiniIssue
                key={i.key}
                issueKey={i.key}
                summary={i.summary}
                trailing={<span className="text-xs text-amber-500">{i.stalledDays}d</span>}
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
  return (
    <button
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-800/70"
      onClick={() => void invoke('shell:openIssue', { issueKey })}
      title={`Abrir ${issueKey} no Jira`}
    >
      <span className="shrink-0 font-mono text-xs text-zinc-500">{issueKey}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{summary}</span>
      {trailing}
    </button>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
