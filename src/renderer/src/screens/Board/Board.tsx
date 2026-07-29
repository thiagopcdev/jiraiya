import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Issue } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { invoke, IpcError } from '../../api/client'
import { useAuthStatus, useBoard } from '../../api/hooks'
import { useIssueDetail } from '../../components/issueDetail'
import { Badge, EmptyState, Spinner } from '../../components/ui'
import { t } from '../../strings/ptBR'

type BoardData = IpcResponse<'board:view'>
type BoardColumn = BoardData['columns'][number]

interface MoveVars {
  issueKey: string
  targetStatusIds: string[]
  targetColumnName: string
}

interface MoveContext {
  previous?: BoardData
  queryKey: readonly [string, number | null, number | null]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0]
}

function borderAccent(category: Issue['statusCategory']): string {
  if (category === 'done') return 'border-l-green-600'
  if (category === 'indeterminate') return 'border-l-indigo-500'
  return 'border-l-zinc-700'
}

export default function Board(): React.JSX.Element {
  const [boardId, setBoardId] = useState<number | undefined>(undefined)
  const [sprintId, setSprintId] = useState<number | undefined>(undefined)
  // null = usuário ainda não mexeu no filtro → default: só os meus cards
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string> | null>(null)
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const [moveError, setMoveError] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const didDragRef = useRef(false)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queryClient = useQueryClient()
  const { data, isLoading, error } = useBoard(boardId, sprintId)
  const { data: authData } = useAuthStatus()
  const { openIssue } = useIssueDetail()
  const myAccountId = authData?.workspace?.accountId ?? null

  useEffect(
    () => () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    },
    []
  )

  // limpa a guarda de drag no window: quando o drop move o card, o update
  // otimista remove o elemento original do DOM e o dragend dele NUNCA dispara —
  // sem isso, didDragRef ficava travado em true e bloqueava os cliques seguintes
  useEffect(() => {
    const clear = (): void => {
      setTimeout(() => {
        didDragRef.current = false
      }, 0)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  const moveMutation = useMutation<IpcResponse<'board:move'>, unknown, MoveVars, MoveContext>({
    mutationFn: (vars) => invoke('board:move', vars),
    onMutate: async (vars) => {
      const queryKey = ['board', boardId ?? null, sprintId ?? null] as const
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<BoardData>(queryKey)
      setPendingKeys((prev) => new Set(prev).add(vars.issueKey))
      queryClient.setQueryData<BoardData>(queryKey, (old) => {
        if (!old) return old
        let moved: Issue | undefined
        for (const col of old.columns) {
          const found = col.issues.find((i) => i.key === vars.issueKey)
          if (found) moved = found
        }
        if (!moved) moved = old.unmapped.find((i) => i.key === vars.issueKey)
        if (!moved) return old
        return {
          ...old,
          columns: old.columns.map((col) => {
            const stripped = col.issues.filter((i) => i.key !== vars.issueKey)
            return col.name === vars.targetColumnName
              ? { ...col, issues: [...stripped, moved as Issue] }
              : { ...col, issues: stripped }
          }),
          unmapped: old.unmapped.filter((i) => i.key !== vars.issueKey)
        }
      })
      return { previous, queryKey }
    },
    onError: (err, _vars, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previous)
      setMoveError(err instanceof IpcError ? err.message : t.common.error)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
      errorTimerRef.current = setTimeout(() => setMoveError(null), 6000)
    },
    onSuccess: (res, vars) => {
      const queryKey = ['board', boardId ?? null, sprintId ?? null] as const
      queryClient.setQueryData<BoardData>(queryKey, (old) => {
        if (!old) return old
        const patch = (issues: Issue[]): Issue[] =>
          issues.map((i) =>
            i.key === vars.issueKey
              ? { ...i, status: res.newStatus, statusCategory: res.newStatusCategory }
              : i
          )
        return {
          ...old,
          columns: old.columns.map((col) => ({ ...col, issues: patch(col.issues) })),
          unmapped: patch(old.unmapped)
        }
      })
    },
    onSettled: (_res, _err, vars) => {
      setPendingKeys((prev) => {
        const next = new Set(prev)
        next.delete(vars.issueKey)
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['board'] })
    }
  })

  const allIssues = useMemo(() => {
    if (!data) return []
    return [...data.columns.flatMap((c) => c.issues), ...data.unmapped]
  }, [data])

  const { people, hasUnassigned } = useMemo(() => {
    const map = new Map<string, { accountId: string; name: string }>()
    let unassigned = false
    for (const issue of allIssues) {
      if (issue.assigneeAccountId) {
        if (!map.has(issue.assigneeAccountId)) {
          map.set(issue.assigneeAccountId, {
            accountId: issue.assigneeAccountId,
            name: issue.assigneeName ?? issue.assigneeAccountId
          })
        }
      } else {
        unassigned = true
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) => {
      if (a.accountId === myAccountId) return -1
      if (b.accountId === myAccountId) return 1
      return a.name.localeCompare(b.name, 'pt-BR')
    })
    return { people: sorted, hasUnassigned: unassigned }
  }, [allIssues, myAccountId])

  // default: filtro no usuário logado (se ele tiver cards no quadro); "Todos" limpa
  const effectiveFilter: Set<string> =
    assigneeFilter ??
    (myAccountId && people.some((p) => p.accountId === myAccountId)
      ? new Set([myAccountId])
      : new Set<string>())

  const filterIssues = (issues: Issue[]): Issue[] =>
    effectiveFilter.size === 0
      ? issues
      : issues.filter((i) => effectiveFilter.has(i.assigneeAccountId ?? ''))

  const toggleAssignee = (key: string): void => {
    const next = new Set(effectiveFilter)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setAssigneeFilter(next)
  }

  const findOriginColumnName = (issueKey: string): string | null => {
    if (!data) return null
    for (const col of data.columns) {
      if (col.issues.some((i) => i.key === issueKey)) return col.name
    }
    return null
  }

  const handleDropOnColumn =
    (col: BoardColumn) =>
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault()
      setDragOverCol(null)
      if (!data || data.readOnly || data.columnsSource !== 'jira') return
      const issueKey = e.dataTransfer.getData('text/plain')
      if (!issueKey) return
      const origin = findOriginColumnName(issueKey)
      if (origin === col.name) return
      moveMutation.mutate({
        issueKey,
        targetStatusIds: col.statusIds,
        targetColumnName: col.name
      })
    }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner className="text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400 light:text-red-600">
          {error instanceof IpcError ? error.message : t.common.error}
        </p>
      </div>
    )
  }

  if (!data) return <EmptyState message={t.common.empty} />

  const isScrum = data.board.type === 'scrum'
  const showSprintSelect = isScrum && data.sprints.length > 0
  const showNoActiveSprint = isScrum && data.sprint === null && sprintId === undefined
  const canDrag = !data.readOnly && data.columnsSource === 'jira'
  const unmappedFiltered = filterIssues(data.unmapped)

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-zinc-100">{t.board.title}</h2>

        {data.boards.length > 1 && (
          <select
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
            value={data.board.jiraId}
            onChange={(e) => {
              setBoardId(Number(e.target.value))
              setSprintId(undefined)
            }}
          >
            {data.boards.map((b) => (
              <option key={b.jiraId} value={b.jiraId}>
                {b.name ?? `Board ${b.jiraId}`}
              </option>
            ))}
          </select>
        )}

        {showSprintSelect && (
          <select
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
            value={sprintId ?? data.sprint?.jiraId ?? ''}
            onChange={(e) => setSprintId(Number(e.target.value))}
          >
            {!data.sprint && sprintId === undefined && (
              <option value="" disabled>
                {t.board.sprintPlaceholder}
              </option>
            )}
            {data.sprints.map((s) => (
              <option key={s.jiraId} value={s.jiraId}>
                {(s.name ?? t.board.sprintFallbackName(s.jiraId)) +
                  (s.state === 'active' ? t.board.activeSuffix : t.board.closedSuffix)}
              </option>
            ))}
          </select>
        )}

        {data.readOnly && <Badge color="amber">{t.board.readOnlyBadge}</Badge>}

        <div className="ml-auto">
          <AssigneeChips
            people={people}
            hasUnassigned={hasUnassigned}
            myAccountId={myAccountId}
            filter={effectiveFilter}
            onToggle={toggleAssignee}
            onClearAll={() => setAssigneeFilter(new Set())}
          />
        </div>
      </div>

      {data.columnsSource === 'fallback' && (
        <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
          {t.board.fallbackBanner}
        </div>
      )}

      {moveError && (
        <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300 light:border-red-300 light:bg-red-50 light:text-red-700">
          {moveError}
        </div>
      )}

      {showNoActiveSprint ? (
        <EmptyState message={t.board.noActiveSprint} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {data.columns.map((col) => {
            const issues = filterIssues(col.issues)
            const sumPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
            return (
              <ColumnView
                key={col.name}
                title={col.name}
                isBacklog={col.isBacklog}
                issues={issues}
                sumPoints={sumPoints}
                isDragOver={dragOverCol === col.name}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverCol(col.name)
                }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={handleDropOnColumn(col)}
                pendingKeys={pendingKeys}
                canDrag={canDrag}
                didDragRef={didDragRef}
                onOpen={openIssue}
              />
            )
          })}
          {unmappedFiltered.length > 0 && (
            <ColumnView
              title={t.board.outOfBoard}
              titleClassName="text-zinc-600"
              issues={unmappedFiltered}
              sumPoints={unmappedFiltered.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
              pendingKeys={pendingKeys}
              canDrag={canDrag}
              didDragRef={didDragRef}
              onOpen={openIssue}
            />
          )}
        </div>
      )}
    </div>
  )
}

function AssigneeChips({
  people,
  hasUnassigned,
  myAccountId,
  filter,
  onToggle,
  onClearAll
}: {
  people: Array<{ accountId: string; name: string }>
  hasUnassigned: boolean
  myAccountId: string | null
  filter: Set<string>
  onToggle: (key: string) => void
  onClearAll: () => void
}): React.JSX.Element {
  const chipClass = (selected: boolean): string =>
    `flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'border-indigo-600 bg-indigo-950/60 text-indigo-200 light:bg-indigo-50 light:text-indigo-700'
        : 'border-zinc-700 text-zinc-300 hover:border-zinc-600'
    }`

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {people.map((p) => (
        <button
          key={p.accountId}
          title={p.accountId === myAccountId ? `${p.name} (você)` : p.name}
          onClick={() => onToggle(p.accountId)}
          className={chipClass(filter.has(p.accountId))}
        >
          <span
            className={`flex size-4 items-center justify-center rounded-full text-[9px] font-semibold ${
              p.accountId === myAccountId ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-200'
            }`}
          >
            {initials(p.name)}
          </span>
          {shortName(p.name)}
        </button>
      ))}
      {hasUnassigned && (
        <button onClick={() => onToggle('')} className={chipClass(filter.has(''))}>
          {t.board.noAssignee}
        </button>
      )}
      <button onClick={onClearAll} className={chipClass(filter.size === 0)}>
        {t.board.all}
      </button>
    </div>
  )
}

function ColumnView({
  title,
  titleClassName,
  isBacklog = false,
  issues,
  sumPoints,
  isDragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  pendingKeys,
  canDrag,
  didDragRef,
  onOpen
}: {
  title: string
  titleClassName?: string
  isBacklog?: boolean
  issues: Issue[]
  sumPoints: number
  isDragOver?: boolean
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void
  pendingKeys: Set<string>
  canDrag: boolean
  didDragRef: React.MutableRefObject<boolean>
  onOpen: (key: string) => void
}): React.JSX.Element {
  return (
    <div
      className={`w-72 shrink-0 rounded-lg p-2 ${
        isBacklog ? 'border border-dashed border-zinc-700 bg-zinc-900/30' : 'bg-zinc-900/60'
      } ${isDragOver ? 'ring-1 ring-indigo-500' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`text-xs font-semibold uppercase ${
              titleClassName ?? (isBacklog ? 'text-zinc-500' : 'text-zinc-400')
            }`}
          >
            {title}
          </span>
          {isBacklog && (
            <span
              title={t.board.backlogHint}
              className="cursor-help rounded-full border border-zinc-700 px-1.5 py-px text-[10px] font-medium text-zinc-500"
            >
              {t.board.backlogBadge}
            </span>
          )}
        </span>
        <span className="text-xs text-zinc-500">
          {issues.length}
          {sumPoints > 0 ? ` · ${sumPoints}sp` : ''}
        </span>
      </div>
      <div className="min-h-24 space-y-2">
        {issues.length === 0 ? (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-zinc-800 text-xs text-zinc-600">
            {t.board.empty}
          </div>
        ) : (
          issues.map((issue) => (
            <CardItem
              key={issue.key}
              issue={issue}
              pending={pendingKeys.has(issue.key)}
              draggable={canDrag}
              didDragRef={didDragRef}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  )
}

function CardItem({
  issue,
  pending,
  draggable,
  didDragRef,
  onOpen
}: {
  issue: Issue
  pending: boolean
  draggable: boolean
  didDragRef: React.MutableRefObject<boolean>
  onOpen: (key: string) => void
}): React.JSX.Element {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', issue.key)
        e.dataTransfer.effectAllowed = 'move'
        didDragRef.current = true
      }}
      onDragEnd={() => {
        setTimeout(() => {
          didDragRef.current = false
        }, 0)
      }}
      onClick={() => {
        if (!didDragRef.current) onOpen(issue.key)
      }}
      className={`cursor-pointer rounded-md border border-zinc-800 border-l-2 bg-zinc-950 p-2.5 hover:border-zinc-600 ${borderAccent(
        issue.statusCategory
      )} ${pending ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-zinc-500">{issue.key}</span>
        {issue.flagged && (
          <span className="text-xs text-red-500" title="Sinalizado">
            ⚑
          </span>
        )}
        {pending && <Spinner className="ml-auto text-zinc-500" />}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-zinc-200">{issue.summary}</p>
      <div className="mt-2 flex items-center justify-between">
        {issue.assigneeName ? (
          <span
            title={issue.assigneeName}
            className="flex size-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200"
          >
            {initials(issue.assigneeName)}
          </span>
        ) : (
          <span />
        )}
        {issue.storyPoints !== null && <Badge color="indigo">{issue.storyPoints}</Badge>}
      </div>
    </div>
  )
}
