import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { IpcResponse } from '@shared/ipc-contract'
import { useEpics } from '../../api/hooks'
import { useIssueDetail } from '../../components/issueDetail'
import { Badge, Card, EmptyState, Spinner } from '../../components/ui'
import { statusColor } from '../../components/statusColor'

type Epic = IpcResponse<'epics:overview'>['epics'][number]

function EpicCard({ epic }: { epic: Epic }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const pct = epic.total > 0 ? Math.round((epic.done / epic.total) * 100) : 0

  return (
    <Card className="space-y-3">
      <button type="button" className="block w-full text-left" onClick={() => openIssue(epic.key)}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-zinc-500">{epic.key}</span>
          {epic.status && <Badge color={statusColor(epic.statusCategory)}>{epic.status}</Badge>}
        </div>
        <div className="mt-1 truncate text-sm font-medium text-indigo-400 hover:underline">
          {epic.summary}
        </div>
      </button>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {epic.done}/{epic.total} cards
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {epic.spTotal > 0 && (
        <p className="text-xs text-zinc-500">
          {epic.spDone}/{epic.spTotal} SP
        </p>
      )}
    </Card>
  )
}

export default function Epics(): React.JSX.Element {
  const { data, isLoading } = useEpics()
  const [showDone, setShowDone] = useState(false)
  const epics = data?.epics ?? []
  const open = epics.filter((e) => e.statusCategory !== 'done')
  const done = epics.filter((e) => e.statusCategory === 'done')

  return (
    <div className="p-6">
      <h2 className="mb-5 text-xl font-semibold text-zinc-100">Épicos</h2>
      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && epics.length === 0 && (
        <EmptyState message="Nenhum épico encontrado no projeto sincronizado." />
      )}
      {!isLoading && epics.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.map((epic) => (
              <EpicCard key={epic.key} epic={epic} />
            ))}
          </div>

          {done.length > 0 && (
            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200"
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                Concluídos ({done.length})
              </button>
              {showDone && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {done.map((epic) => (
                    <EpicCard key={epic.key} epic={epic} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
