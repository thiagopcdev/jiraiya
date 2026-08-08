import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { IpcResponse } from '@shared/ipc-contract'
import { useEpics } from '../../api/hooks'
import { useIssueDetail } from '../../components/issueDetail'
import { Badge, Card, EmptyState, ScreenHeader, Spinner } from '../../components/ui'
import { statusColor } from '../../components/statusColor'

type Epic = IpcResponse<'epics:overview'>['epics'][number]

function EpicCard({ epic }: { epic: Epic }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const pct = epic.total > 0 ? Math.round((epic.done / epic.total) * 100) : 0

  return (
    <Card bodyClassName="flex flex-col gap-2.5 px-[15px] py-[13px]">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] text-zinc-400">{epic.key}</span>
        {epic.status && (
          <span className="ml-auto">
            <Badge color={statusColor(epic.statusCategory)}>{epic.status}</Badge>
          </span>
        )}
      </div>

      <button
        type="button"
        className="block w-full truncate text-left text-[13.5px] font-semibold text-indigo-400 hover:underline"
        onClick={() => openIssue(epic.key)}
        title={`Abrir ${epic.key}`}
      >
        {epic.summary}
      </button>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-zinc-500">
          <span>
            {epic.done}/{epic.total} cards
          </span>
          <span className="font-bold text-zinc-200">{pct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {epic.spTotal > 0 && (
        <p className="text-[11.5px] text-zinc-500">
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
  const spTotal = epics.reduce((sum, e) => sum + e.spTotal, 0)

  // contexto do cabeçalho conta exatamente o que a grade renderiza
  const context =
    epics.length > 0
      ? [
          `${open.length} aberto${open.length === 1 ? '' : 's'}`,
          `${done.length} concluído${done.length === 1 ? '' : 's'}`,
          spTotal > 0 ? `${spTotal} sp no total` : null
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Épicos" context={context} />
      <div className="flex-1 overflow-y-auto px-6 py-[18px]">
        {isLoading && <Spinner className="text-zinc-500" />}
        {!isLoading && epics.length === 0 && (
          <EmptyState message="Nenhum épico encontrado no projeto sincronizado." />
        )}
        {!isLoading && epics.length > 0 && (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-3 gap-3.5">
              {open.map((epic) => (
                <EpicCard key={epic.key} epic={epic} />
              ))}
            </div>

            {done.length > 0 && (
              <>
                <button
                  type="button"
                  className="flex items-center gap-[7px] text-[13px] font-semibold text-zinc-400 hover:text-zinc-200"
                  onClick={() => setShowDone((v) => !v)}
                  aria-expanded={showDone}
                >
                  {showDone ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  Concluídos ({done.length})
                </button>
                {showDone && (
                  <div className="grid grid-cols-3 items-start gap-3.5">
                    {done.map((epic) => (
                      <EpicCard key={epic.key} epic={epic} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
