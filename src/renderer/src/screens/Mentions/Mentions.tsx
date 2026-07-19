import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ExternalLink } from 'lucide-react'
import type { Mention } from '@shared/domain'
import { useMentions } from '../../api/hooks'
import { invoke } from '../../api/client'
import { EmptyState, Spinner } from '../../components/ui'
import { useIssueDetail } from '../../components/issueDetail'

export default function Mentions(): React.JSX.Element {
  const { data, isLoading } = useMentions()
  const queryClient = useQueryClient()
  const markedRef = useRef(false)

  const unreadCount = data?.unreadCount ?? 0
  useEffect(() => {
    if (unreadCount > 0 && !markedRef.current) {
      markedRef.current = true
      void invoke('mentions:markAllRead', {}).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['mentions'] })
      })
    }
  }, [unreadCount, queryClient])

  const groups = useMemo(() => groupByDay(data?.mentions ?? []), [data])

  return (
    <div className="p-6">
      <h2 className="mb-5 text-xl font-semibold text-zinc-100">Menções</h2>

      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && groups.length === 0 && <EmptyState message="Nenhuma menção a você ainda." />}

      <div className="space-y-6">
        {groups.map(({ day, items }) => (
          <section key={day}>
            <h3 className="mb-2 text-sm font-semibold text-zinc-400">{dayLabel(day)}</h3>
            <div className="space-y-0.5 border-l border-zinc-800 pl-4">
              {items.map((m) => (
                <MentionRow key={m.id} mention={m} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function MentionRow({ mention }: { mention: Mention }): React.JSX.Element {
  const unread = mention.readAt === null
  const { openIssue } = useIssueDetail()

  return (
    <button
      className={`group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/60 ${
        unread ? 'bg-zinc-900/60' : ''
      }`}
      onClick={() => openIssue(mention.issueKey)}
      title={mention.issueKey}
    >
      <span className="mt-1.5 shrink-0">
        {unread ? (
          <span className="block size-1.5 rounded-full bg-indigo-400" />
        ) : (
          <span className="block size-1.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="font-medium text-zinc-300">{mention.authorName ?? 'Alguém'}</span>
          <span className="text-zinc-400">mencionou você em</span>
          <span className="font-mono text-xs text-zinc-500">{mention.issueKey}</span>
        </div>
        {mention.issueSummary && (
          <div className="truncate text-xs text-zinc-500">{mention.issueSummary}</div>
        )}
        {mention.excerpt && (
          <div className="mt-1 line-clamp-2 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
            {mention.excerpt}
          </div>
        )}
      </div>
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${mention.issueKey} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey: mention.issueKey })
        }}
      >
        <ExternalLink size={13} />
      </span>
      <span className="shrink-0 text-xs text-zinc-600">
        {format(new Date(mention.occurredAt), 'HH:mm')}
      </span>
    </button>
  )
}

function groupByDay(mentions: Mention[]): Array<{ day: string; items: Mention[] }> {
  const map = new Map<string, Mention[]>()
  for (const m of mentions) {
    const day = format(new Date(m.occurredAt), 'yyyy-MM-dd')
    const list = map.get(day) ?? []
    list.push(m)
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
