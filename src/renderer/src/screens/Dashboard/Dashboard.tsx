import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { Issue } from '@shared/domain'
import { useIssues } from '../../api/hooks'
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
      </div>
    </div>
  )
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
      className={`mb-4 ${has ? 'border-red-900/50 bg-red-950/20' : ''}`}
      title={
        <span className={`flex items-center gap-2 ${has ? 'text-red-300' : 'text-zinc-300'}`}>
          <AlertTriangle size={15} className={has ? '' : 'text-zinc-500'} />
          Reprovados
          <span
            className={`rounded px-1.5 text-xs ${has ? 'bg-red-900/50' : 'bg-zinc-800 text-zinc-400'}`}
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
  const { data } = useIssues({ type: 'sprint' }, 'all')
  const issues = data?.issues ?? []
  const done = issues.filter((i) => i.statusCategory === 'done').length
  const open = issues.length - done
  return (
    <div className="mb-4 flex items-center gap-6 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
      <Stat label="Na sprint" value={issues.length} />
      <Stat label="Concluídas" value={done} />
      <Stat label="Abertas" value={open} />
      {issues.length > 0 && (
        <div className="ml-auto text-xs text-zinc-500">
          {Math.round((done / issues.length) * 100)}% concluído
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
