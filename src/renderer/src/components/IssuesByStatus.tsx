import { differenceInCalendarDays, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ExternalLink, Pause, Play } from 'lucide-react'
import type { Issue } from '@shared/domain'
import { invoke } from '../api/client'
import { Badge } from './ui'
import { groupByStatus } from './groupByStatus'
import { useIssueDetail } from './issueDetail'
import { formatTimer, useIssueTimer } from '../lib/timer'
import { t } from '../strings/ptBR'

/**
 * Lista de issues subagrupada pelo status real (ex.: "Pronto para teste (4)",
 * "Em teste (1)"). Usada onde um único status-category do Jira esconde vários
 * status distintos — como o "em andamento".
 *
 * `variant='primary'` é o painel "Em andamento" da tela Hoje: linhas maiores,
 * com idade (relativa ao stalledDays da pref) e botão de timer. Os demais
 * consumidores (Time) não passam `variant`, então continuam com o visual
 * compacto de sempre — só a Hoje pediu a hierarquia mais forte.
 */
export function IssuesByStatus({
  issues,
  variant = 'list',
  stalledDays = 3
}: {
  issues: Issue[]
  variant?: 'list' | 'primary'
  stalledDays?: number
}): React.JSX.Element {
  const groups = groupByStatus(issues)

  if (variant === 'primary') {
    return (
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.status} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[11px] font-bold tracking-[.06em] text-blue-300 uppercase light:text-blue-700">
                {group.status}
              </span>
              <span className="text-[11px] text-zinc-600">{group.issues.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {group.issues.map((issue) => (
                <PrimaryIssueRow key={issue.key} issue={issue} stalledDays={stalledDays} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.status}>
          <div className="mb-0.5 px-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {group.status} <span className="text-zinc-600">({group.issues.length})</span>
          </div>
          <div className="space-y-0.5">
            {group.issues.map((issue) => (
              <IssueLine key={issue.key} issue={issue} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function IssueLine({ issue }: { issue: Issue }): React.JSX.Element {
  const { openIssue } = useIssueDetail()

  return (
    <button
      className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-zinc-800/70"
      onClick={() => openIssue(issue.key)}
      title={`Abrir ${issue.key}`}
    >
      <span className="shrink-0 font-mono text-[11.5px] text-zinc-500">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-300">{issue.summary}</span>
      {issue.storyPoints !== null && <Badge color="indigo">{issue.storyPoints}</Badge>}
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${issue.key} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey: issue.key })
        }}
      >
        <ExternalLink size={12} />
      </span>
    </button>
  )
}

/**
 * Linha grande do painel primário: idade relativa (fica âmbar acima do
 * `stalledDays` da pref) + badge de story points + botão de timer. O timer
 * roda no store global de `lib/timer.ts` (mesmo usado pela gaveta do card e
 * pelo widget flutuante) — nenhum estado novo aqui.
 */
function PrimaryIssueRow({
  issue,
  stalledDays
}: {
  issue: Issue
  stalledDays: number
}): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const timer = useIssueTimer(issue.key)
  const reference = issue.updatedAt ?? issue.createdAt
  const ageDays = reference ? differenceInCalendarDays(new Date(), new Date(reference)) : null
  const isStalled = ageDays !== null && ageDays > stalledDays
  const ageLabel = reference
    ? formatDistanceToNow(new Date(reference), { addSuffix: true, locale: ptBR })
    : null

  return (
    // o card com timer rodando é o único destaque de marca da lista: borda e
    // fundo de indigo com alfa, para não brigar com o azul do rótulo de status
    <div
      className={`group flex items-center gap-2.5 rounded-md border px-3 py-2.5 compact:py-1.5 ${
        timer.running ? 'border-indigo-600/45 bg-indigo-600/8' : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={() => openIssue(issue.key)}
        title={`Abrir ${issue.key}`}
      >
        <span
          className={`shrink-0 font-mono text-[11.5px] ${
            timer.running ? 'font-semibold text-indigo-400' : 'text-zinc-500'
          }`}
        >
          {issue.key}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] ${
            timer.running ? 'font-semibold text-zinc-50' : 'text-zinc-200'
          }`}
        >
          {issue.summary}
        </span>
        {ageLabel && (
          <span
            className={`shrink-0 text-[11.5px] ${
              isStalled ? 'font-semibold text-amber-400 light:text-amber-600' : 'text-zinc-500'
            }`}
          >
            {ageLabel}
          </span>
        )}
        {issue.storyPoints !== null ? (
          <Badge color="indigo">{issue.storyPoints}</Badge>
        ) : (
          <Badge color="zinc">{t.today.noStoryPoints}</Badge>
        )}
      </button>
      <button
        className={
          timer.running
            ? 'flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white'
            : 'flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800'
        }
        onClick={() => (timer.running ? timer.pause() : timer.start())}
      >
        {timer.running ? <Pause size={12} /> : <Play size={12} />}
        {timer.running ? formatTimer(timer.seconds) : t.today.startTimer}
      </button>
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${issue.key} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey: issue.key })
        }}
      >
        <ExternalLink size={12} />
      </span>
    </div>
  )
}
