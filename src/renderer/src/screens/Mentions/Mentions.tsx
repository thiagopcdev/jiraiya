import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ExternalLink } from 'lucide-react'
import type { Mention } from '@shared/domain'
import { useMentions } from '../../api/hooks'
import { invoke } from '../../api/client'
import { Badge, Card, EmptyState, ScreenHeader, Spinner } from '../../components/ui'
import { useIssueDetail } from '../../components/issueDetail'

export default function Mentions(): React.JSX.Element {
  const { data, isLoading } = useMentions()
  const queryClient = useQueryClient()
  const markedRef = useRef(false)

  // Abrir a tela marca tudo como lido, então o refetch seguinte devolve todo
  // `readAt` preenchido e os pontinhos sumiriam na cara de quem acabou de
  // chegar. Congela quem estava por ler antes de disparar o markAllRead — é o
  // que sustenta o "N novas" na faixa de título do dia durante a visita.
  const [wasUnread, setWasUnread] = useState<ReadonlySet<number> | null>(null)
  const unreadCount = data?.unreadCount ?? 0
  useEffect(() => {
    if (unreadCount > 0 && !markedRef.current) {
      markedRef.current = true
      const ids = new Set((data?.mentions ?? []).filter((m) => m.readAt === null).map((m) => m.id))
      void invoke('mentions:markAllRead', {}).then(() => {
        setWasUnread(ids)
        void queryClient.invalidateQueries({ queryKey: ['mentions'] })
      })
    }
  }, [unreadCount, data, queryClient])

  const isUnread = (mention: Mention): boolean =>
    wasUnread ? wasUnread.has(mention.id) : mention.readAt === null

  const mentions = useMemo(() => data?.mentions ?? [], [data])
  const groups = useMemo(() => groupByDay(mentions), [mentions])
  const unreadTotal = mentions.filter(isUnread).length

  // "novas nesta visita", e não "não lidas": abrir a tela já marca tudo como
  // lido, então o crachá da nav zera enquanto os pontinhos daqui seguem acesos.
  // Dizer "não lidas" faria os dois contadores se contradizerem na mesma tela.
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Menções"
        context={
          mentions.length > 0
            ? `${unreadTotal} ${unreadTotal === 1 ? 'nova' : 'novas'} nesta visita · ${mentions.length} no total`
            : undefined
        }
      />
      <div className="flex-1 overflow-y-auto px-6 py-[18px]">
        {isLoading && <Spinner className="text-zinc-500" />}
        {!isLoading && groups.length === 0 && <EmptyState message="Nenhuma menção a você ainda." />}

        {/* quem agrupa é o cartão do dia — a borda-guia à esquerda saiu */}
        <div className="flex max-w-[820px] flex-col gap-3.5">
          {groups.map(({ day, items }) => {
            const unreadInDay = items.filter(isUnread).length
            return (
              <Card
                key={day}
                title={
                  <span className="flex items-center gap-2.5">
                    {dayLabel(day)}
                    {unreadInDay > 0 && (
                      <Badge color="brand">
                        {unreadInDay} {unreadInDay === 1 ? 'nova' : 'novas'}
                      </Badge>
                    )}
                  </span>
                }
                bodyClassName="px-4 pt-0.5 pb-2.5"
              >
                <div className="flex flex-col divide-y divide-zinc-800/70">
                  {items.map((m) => (
                    <MentionRow key={m.id} mention={m} unread={isUnread(m)} />
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MentionRow({ mention, unread }: { mention: Mention; unread: boolean }): React.JSX.Element {
  const { openIssue } = useIssueDetail()

  return (
    <button
      className="group flex w-full items-start gap-3 py-2.5 text-left"
      onClick={() => openIssue(mention.issueKey)}
      title={mention.issueKey}
    >
      {/* o ponto ocupa o lugar mesmo quando lida, senão a coluna de texto dança */}
      <span
        className={`mt-[7px] size-1.5 shrink-0 rounded-full ${unread ? 'bg-indigo-400' : 'bg-transparent'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-zinc-400">
          <span className="font-semibold text-zinc-50">{mention.authorName ?? 'Alguém'}</span>{' '}
          mencionou você em{' '}
          <span className="font-mono text-[11.5px] text-indigo-400">{mention.issueKey}</span>
        </div>
        {mention.issueSummary && (
          <div className="mt-px truncate text-xs text-zinc-500">{mention.issueSummary}</div>
        )}
        {/* line-clamp: comentário longo sem teto estica a linha e quebra o
            ritmo do cartão do dia */}
        {mention.excerpt && (
          <div className="mt-1.5 line-clamp-2 max-w-[70ch] rounded-r-md border-l-2 border-zinc-700 bg-zinc-950/60 px-2.5 py-[7px] text-[12.5px] leading-relaxed text-zinc-300">
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
      <span className="shrink-0 text-[11.5px] text-zinc-600">
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
