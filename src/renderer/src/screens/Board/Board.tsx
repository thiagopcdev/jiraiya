import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Issue } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { invoke, IpcError } from '../../api/client'
import { useAuthStatus, useBoard } from '../../api/hooks'
import { useIssueDetail } from '../../components/issueDetail'
import { useOpenIssueKey } from '../../components/IssueDetailProvider'
import { Badge, EmptyState, ScreenHeader, Spinner } from '../../components/ui'
import { t } from '../../strings/ptBR'
import BoardScrollMinimap from './BoardScrollMinimap'
import { getSessionBoardId, setSessionBoardId } from './boardSession'

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

/** Acento de 3px na borda esquerda do card, por categoria de status. */
function borderAccent(category: Issue['statusCategory']): string {
  if (category === 'done') return 'border-l-green-600'
  if (category === 'indeterminate') return 'border-l-indigo-600'
  return 'border-l-zinc-700'
}

/** `<select>` do cabeçalho — mesma pele dos selects do resto do app. */
const HEADER_SELECT_CLASS =
  'rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200'

export default function Board(): React.JSX.Element {
  const [boardId, setBoardId] = useState<number | undefined>(getSessionBoardId())
  const [sprintId, setSprintId] = useState<number | undefined>(undefined)
  // null = usuário ainda não mexeu no filtro → default: só os meus cards
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string> | null>(null)
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const [moveError, setMoveError] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const didDragRef = useRef(false)
  const columnsRef = useRef<HTMLDivElement>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const queryClient = useQueryClient()
  const { data, isLoading, error } = useBoard(boardId, sprintId)
  const { data: authData } = useAuthStatus()
  const { openIssue, DockedPanel } = useIssueDetail()
  // card aberto no painel/gaveta: é ele que ganha a moldura de seleção no quadro
  const openKey = useOpenIssueKey()
  const myAccountId = authData?.workspace?.accountId ?? null

  useEffect(
    () => () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    },
    []
  )

  // registra o board resolvido (default do main ou troca no seletor) para as
  // próximas montagens da sessão
  useEffect(() => {
    if (data) setSessionBoardId(data.board.jiraId)
  }, [data])

  // board da sessão sumiu (ex.: apagado no Jira e podado no sync) → volta ao
  // default; ajuste de estado durante o render, padrão do React para estado
  // derivado — o effect equivalente dispararia renders em cascata (lint)
  if (boardId !== undefined && error instanceof IpcError && error.code === 'BOARD_NOT_FOUND') {
    setSessionBoardId(undefined)
    setBoardId(undefined)
  }

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
      // card excluído no Jira: o main já tirou do cache local — devolver o card
      // à coluna de origem só o faria piscar até o refetch do onSettled
      const gone = err instanceof IpcError && err.code === 'ISSUE_GONE'
      if (context && !gone) queryClient.setQueryData(context.queryKey, context.previous)
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

  // linha de contexto do ScreenHeader: leitura geral da sprint (todas as
  // issues carregadas, sem o filtro de responsável — o filtro é uma lente
  // sobre o mesmo escopo, não muda o que a sprint contém).
  const boardLabel = data.board.name ?? `Board ${data.board.jiraId}`
  const sprintMeta = data.sprint
    ? data.sprints.find((s) => s.jiraId === data.sprint?.jiraId)
    : undefined
  const sprintLabel = data.sprint
    ? (sprintMeta?.name ?? data.sprint.name) +
      (sprintMeta?.state === 'active'
        ? t.board.activeSuffix
        : sprintMeta?.state === 'closed'
          ? t.board.closedSuffix
          : '')
    : null
  const remainingPoints = allIssues.reduce(
    (sum, i) => (i.statusCategory === 'done' ? sum : sum + (i.storyPoints ?? 0)),
    0
  )

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        flush
        title={t.board.title}
        context={t.board.context(boardLabel, sprintLabel, allIssues.length, remainingPoints)}
        actions={
          <>
            {data.boards.length > 1 && (
              <select
                className={HEADER_SELECT_CLASS}
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
                className={HEADER_SELECT_CLASS}
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
          </>
        }
      />

      {/* faixa de filtro de responsável: linha própria abaixo do título (o
          ScreenHeader vai `flush` e quem fecha o bloco é esta borda) */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-5 pb-3">
        <AssigneeChips
          people={people}
          hasUnassigned={hasUnassigned}
          myAccountId={myAccountId}
          filter={effectiveFilter}
          onToggle={toggleAssignee}
          onClearAll={() => setAssigneeFilter(new Set())}
        />
      </div>

      {/* linha cheia abaixo do cabeçalho: área de colunas (rola vertical e vira
          irmã do painel docado) + o painel em si, ambos esticando a altura toda */}
      <div className="flex min-h-0 flex-1">
        {/* p-4 (16px) não é decoração: 1360 − 216 (nav) − 380 (painel) − 32
            (este padding) − 24 (gaps) = 708 = exatamente 3 colunas de 236 */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-4">
          {data.columnsSource === 'fallback' && (
            <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-500">
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
            <div ref={columnsRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
              {data.columns.map((col) => {
                const issues = filterIssues(col.issues)
                const sumPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
                return (
                  <ColumnView
                    key={col.name}
                    title={col.name}
                    isBacklog={col.isBacklog}
                    wipMax={col.wipMax}
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
                    openKey={openKey}
                  />
                )
              })}
              {unmappedFiltered.length > 0 && (
                <ColumnView
                  title={t.board.outOfBoard}
                  titleClassName="text-zinc-400"
                  issues={unmappedFiltered}
                  sumPoints={unmappedFiltered.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)}
                  pendingKeys={pendingKeys}
                  canDrag={canDrag}
                  didDragRef={didDragRef}
                  onOpen={openIssue}
                  openKey={openKey}
                />
              )}
            </div>
          )}

          {/* avisa que há colunas fora do campo de visão (e navega entre elas) */}
          {!showNoActiveSprint && (
            <BoardScrollMinimap
              scrollRef={columnsRef}
              revision={`${data.columns.map((c) => c.name).join('|')}#${unmappedFiltered.length > 0}`}
            />
          )}
        </div>
        <DockedPanel />
      </div>
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
  // chip com avatar tem padding menor à esquerda (o avatar já dá o respiro);
  // o de texto puro fica simétrico
  const chipClass = (selected: boolean, withAvatar: boolean): string =>
    `flex items-center gap-1.5 rounded-full border py-[3px] text-xs transition-colors ${
      withAvatar ? 'pr-2.5 pl-1' : 'px-3'
    } ${
      selected
        ? 'border-indigo-500 bg-indigo-600/12 font-semibold text-indigo-400'
        : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
    }`

  return (
    <>
      {people.map((p) => (
        <button
          key={p.accountId}
          title={p.accountId === myAccountId ? `${p.name} (você)` : p.name}
          onClick={() => onToggle(p.accountId)}
          className={chipClass(filter.has(p.accountId), true)}
        >
          <span
            className={`flex size-[19px] items-center justify-center rounded-full text-[9px] font-bold ${
              p.accountId === myAccountId
                ? 'bg-indigo-600 text-white'
                : 'bg-indigo-900 text-indigo-400'
            }`}
          >
            {initials(p.name)}
          </span>
          {shortName(p.name)}
        </button>
      ))}
      {hasUnassigned && (
        <button onClick={() => onToggle('')} className={chipClass(filter.has(''), false)}>
          {t.board.noAssignee}
        </button>
      )}
      <button onClick={onClearAll} className={chipClass(filter.size === 0, false)}>
        {t.board.all}
      </button>
    </>
  )
}

/**
 * Limite de WIP da coluna. Estouro usa o vermelho de atenção do app (o Jira
 * também destaca a coluna quando passa do configurado); dentro do limite é a
 * pílula âmbar do design system.
 */
function WipBadge({ over, children }: { over: boolean; children: string }): React.JSX.Element {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 text-[10.5px] font-bold ${
        over
          ? 'bg-red-600/16 text-red-400 light:text-red-600'
          : 'bg-amber-600/16 text-amber-400 light:text-amber-600'
      }`}
    >
      {children}
    </span>
  )
}

function ColumnView({
  title,
  titleClassName,
  isBacklog = false,
  wipMax,
  issues,
  sumPoints,
  isDragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  pendingKeys,
  canDrag,
  didDragRef,
  onOpen,
  openKey
}: {
  title: string
  titleClassName?: string
  isBacklog?: boolean
  /** limite de WIP da coluna (ausente/null = board sem constraint configurada) */
  wipMax?: number | null
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
  /** card aberto no painel de detalhe — ganha a moldura de seleção */
  openKey: string | null
}): React.JSX.Element {
  const overWip = wipMax != null && issues.length > wipMax
  return (
    // a calha é painel in-flow: sem sombra. O piso de 236px só fecha a conta de
    // largura porque o box-sizing:border-box do preflight conta o p-2 — não
    // sobrescreva.
    <div
      className={`flex min-w-[236px] flex-1 basis-[236px] flex-col rounded-lg p-2 ${
        isBacklog ? 'border border-dashed border-zinc-700 bg-zinc-800/30' : 'bg-zinc-800/60'
      } ${isDragOver ? 'ring-2 ring-indigo-500/70' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-2.5">
        <span
          className={`truncate text-[12.5px] font-bold ${
            titleClassName ?? (isBacklog ? 'text-zinc-400' : 'text-zinc-50')
          }`}
        >
          {title}
        </span>
        {isBacklog && (
          <span
            title={t.board.backlogHint}
            className="shrink-0 cursor-help rounded-full border border-zinc-700 px-1.5 text-[10.5px] font-medium text-zinc-500"
          >
            {t.board.backlogBadge}
          </span>
        )}
        {wipMax != null && (
          <WipBadge over={overWip}>{t.board.wipLimit(issues.length, wipMax)}</WipBadge>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-400">
          {t.board.columnSummary(issues.length, sumPoints)}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {issues.length === 0 ? (
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-zinc-700 text-xs text-zinc-500">
            {t.board.empty}
          </div>
        ) : (
          issues.map((issue) => (
            <CardItem
              key={issue.key}
              issue={issue}
              pending={pendingKeys.has(issue.key)}
              selected={issue.key === openKey}
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
  selected,
  draggable,
  didDragRef,
  onOpen
}: {
  issue: Issue
  pending: boolean
  selected: boolean
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
      // a ordem importa: `border-l-*` sai depois de `border-*` na folha do
      // Tailwind, então o acento de categoria sobrevive à cor de seleção
      className={`cursor-pointer rounded-md border border-l-[3px] bg-zinc-900 p-2.5 shadow-card transition-colors ${
        selected
          ? 'border-indigo-600/60 ring-2 ring-indigo-600/15'
          : 'border-zinc-800 hover:border-zinc-700'
      } ${borderAccent(issue.statusCategory)} ${pending ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] font-semibold text-indigo-400">{issue.key}</span>
        {issue.flagged && (
          <span className="text-xs text-red-400 light:text-red-600" title="Sinalizado">
            ⚑
          </span>
        )}
        {pending ? (
          <Spinner className="ml-auto text-zinc-500" />
        ) : (
          issue.storyPoints !== null && (
            <span className="ml-auto rounded-full bg-zinc-800 px-[7px] text-[10.5px] font-bold text-zinc-400">
              {issue.storyPoints}
            </span>
          )
        )}
      </div>
      <p
        className={`mt-1.5 line-clamp-2 text-[12.5px] leading-[1.4] ${
          selected ? 'font-semibold text-zinc-50' : 'text-zinc-200'
        }`}
      >
        {issue.summary}
      </p>
      {issue.assigneeName && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            title={issue.assigneeName}
            className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-indigo-900 text-[9px] font-bold text-indigo-400"
          >
            {initials(issue.assigneeName)}
          </span>
          <span className="min-w-0 truncate text-[11px] text-zinc-400">
            {shortName(issue.assigneeName)}
          </span>
        </div>
      )}
    </div>
  )
}
