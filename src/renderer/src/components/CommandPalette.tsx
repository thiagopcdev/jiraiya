import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { invoke, IpcError } from '../api/client'
import { useAuthStatus, useGlobalSearch } from '../api/hooks'
import { Badge, Spinner } from './ui'
import { statusColor } from './statusColor'
import { useIssueDetail } from './issueDetail'
import { parseQuickAction, quickActionVerb, type QuickAction } from '../lib/quickActions'
import { t } from '../strings/ptBR'

/** Dono do estado aberto/fechado + listener global do atalho. O conteúdo (busca,
 * seleção) vive em PaletteModal, montado só enquanto aberto — assim o estado
 * reseta sozinho a cada abertura, sem precisar sincronizar via efeito. */
export default function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isToggle) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    // ponte para o campo de busca da sidebar (mesmo gatilho do ⌘K)
    const openFromUi = (): void => setOpen(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('jiraiya:open-palette', openFromUi)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('jiraiya:open-palette', openFromUi)
    }
  }, [])

  if (!open) return null
  return <PaletteModal onClose={() => setOpen(false)} />
}

/** Quebra o snippet do FTS em pedaços, destacando os termos entre 「 e 」. */
function renderSnippet(snippet: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /「(.+?)」/g
  let lastIndex = 0
  let idx = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(snippet))) {
    if (match.index > lastIndex) {
      nodes.push(snippet.slice(lastIndex, match.index))
    }
    nodes.push(
      <mark
        key={idx}
        className="rounded bg-indigo-900/50 text-indigo-200 light:bg-indigo-200 light:text-indigo-700"
      >
        {match[1]}
      </mark>
    )
    idx += 1
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < snippet.length) {
    nodes.push(snippet.slice(lastIndex))
  }
  return nodes
}

/** Remove diacríticos e baixa a caixa, para comparar status/pessoas ignorando acento. */
function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

type Phase = 'idle' | 'loading' | 'done' | 'queued' | 'error'

/** Estado comum de execução de uma ação rápida: fase, mensagem de erro, invalidação
 * das queries afetadas no sucesso e fechamento automático do modal (mais rápido
 * quando concluída de fato, um pouco mais devagar quando só foi enfileirada offline
 * para dar tempo de ler o aviso). */
function useActionPhase(
  issueKey: string,
  onClose: () => void
): {
  phase: Phase
  errorMessage: string | null
  begin: () => void
  succeed: (queued: boolean) => void
  fail: (err: unknown) => void
} {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const begin = (): void => setPhase('loading')

  const succeed = (queued: boolean): void => {
    void queryClient.invalidateQueries({ queryKey: ['board'] })
    void queryClient.invalidateQueries({ queryKey: ['issue', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['issues'] })
    void queryClient.invalidateQueries({ queryKey: ['queue'] })
    if (queued) {
      setPhase('queued')
      setTimeout(onClose, 1200)
    } else {
      setPhase('done')
      setTimeout(onClose, 700)
    }
  }

  const fail = (err: unknown): void => {
    setPhase('error')
    setErrorMessage(err instanceof IpcError ? err.message : 'Erro ao executar a ação.')
  }

  return { phase, errorMessage, begin, succeed, fail }
}

function ActionStatus({
  phase,
  errorMessage
}: {
  phase: Phase
  errorMessage: string | null
}): React.JSX.Element | null {
  if (phase === 'idle') return null
  if (phase === 'loading') {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-400">
        <Spinner />
        {t.palette.actionLoading}
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <p className="px-3 py-3 text-sm text-green-400 light:text-green-600">
        {t.palette.actionDone}
      </p>
    )
  }
  if (phase === 'queued') {
    return (
      <p className="px-3 py-3 text-sm text-amber-400 light:text-amber-600">
        {t.palette.actionQueued}
      </p>
    )
  }
  return <p className="px-3 py-3 text-sm text-red-400 light:text-red-600">{errorMessage}</p>
}

function ActionHeader({ label, issueKey }: { label: string; issueKey: string }): React.JSX.Element {
  return (
    <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">
      {label} <span className="font-mono text-zinc-400">{issueKey}</span>
    </div>
  )
}

function MoveAction({
  action,
  onClose
}: {
  action: Extract<QuickAction, { kind: 'move' }>
  onClose: () => void
}): React.JSX.Element {
  const { data, isFetching } = useQuery({
    queryKey: ['issue-transitions', action.key],
    queryFn: () => invoke('issues:transitions', { key: action.key })
  })
  const { phase, errorMessage, begin, succeed, fail } = useActionPhase(action.key, onClose)
  const [rawActiveIndex, setRawActiveIndex] = useState(0)

  const query = normalizeText(action.statusQuery)
  const candidates = (data?.transitions ?? []).filter((tr) =>
    normalizeText(tr.toStatusName).includes(query)
  )
  const activeIndex = Math.min(rawActiveIndex, Math.max(candidates.length - 1, 0))

  const run = (target: (typeof candidates)[number]): void => {
    begin()
    void invoke('issues:transition', {
      key: action.key,
      transitionId: target.id,
      toStatusName: target.toStatusName,
      toCategoryKey: target.toCategoryKey
    })
      .then((res) => succeed(res.queued))
      .catch(fail)
  }

  useEffect(() => {
    if (phase !== 'idle') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setRawActiveIndex((i) => Math.min(i + 1, candidates.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setRawActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const target = candidates[activeIndex]
        if (target) run(target)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <>
      <ActionHeader label={t.palette.actionMove} issueKey={action.key} />
      {phase !== 'idle' ? (
        <ActionStatus phase={phase} errorMessage={errorMessage} />
      ) : isFetching ? (
        <div className="flex justify-center px-3 py-6">
          <Spinner className="text-zinc-500" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-zinc-500">{t.palette.actionNoMatch}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto py-1">
          {candidates.map((c, i) => (
            <button
              key={c.id}
              className={`flex w-full items-center px-3 py-2 text-left text-sm text-zinc-200 ${
                i === activeIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
              }`}
              onMouseEnter={() => setRawActiveIndex(i)}
              onClick={() => run(c)}
            >
              {c.toStatusName}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function AssignAction({
  action,
  onClose
}: {
  action: Extract<QuickAction, { kind: 'assign' }>
  onClose: () => void
}): React.JSX.Element {
  const { phase, errorMessage, begin, succeed, fail } = useActionPhase(action.key, onClose)
  const { data: authData } = useAuthStatus()
  const myAccountId = authData?.workspace?.accountId ?? null
  const myDisplayName = authData?.workspace?.displayName ?? authData?.workspace?.email ?? null

  const { data, isFetching } = useQuery({
    queryKey: ['issue-assignable', action.key],
    queryFn: () => invoke('issues:assignable', { key: action.key }),
    enabled: !action.toMe
  })

  const query = normalizeText(action.assigneeQuery)
  const candidates = action.toMe
    ? []
    : (data?.users ?? []).filter((u) => normalizeText(u.displayName).includes(query))
  const [rawActiveIndex, setRawActiveIndex] = useState(0)
  const activeIndex = Math.min(rawActiveIndex, Math.max(candidates.length - 1, 0))

  const runUser = (target: (typeof candidates)[number]): void => {
    begin()
    void invoke('issues:update', {
      key: action.key,
      assigneeAccountId: target.accountId,
      assigneeName: target.displayName
    })
      .then((res) => succeed(res.queued))
      .catch(fail)
  }

  const runMe = (): void => {
    if (!myAccountId) return
    begin()
    void invoke('issues:update', {
      key: action.key,
      assigneeAccountId: myAccountId,
      assigneeName: myDisplayName
    })
      .then((res) => succeed(res.queued))
      .catch(fail)
  }

  useEffect(() => {
    if (phase !== 'idle') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (action.toMe) {
        if (e.key === 'Enter') {
          e.preventDefault()
          runMe()
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setRawActiveIndex((i) => Math.min(i + 1, candidates.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setRawActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const target = candidates[activeIndex]
        if (target) runUser(target)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <>
      <ActionHeader
        label={action.toMe ? t.palette.actionAssignMe : t.palette.actionAssign}
        issueKey={action.key}
      />
      {phase !== 'idle' ? (
        <ActionStatus phase={phase} errorMessage={errorMessage} />
      ) : action.toMe ? (
        myAccountId ? (
          <button
            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/60"
            onClick={runMe}
          >
            <span>{myDisplayName ?? t.palette.actionAssignMe}</span>
            <span className="shrink-0 text-xs text-zinc-500">{t.palette.actionRun}</span>
          </button>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">{t.palette.actionNoUser}</p>
        )
      ) : isFetching ? (
        <div className="flex justify-center px-3 py-6">
          <Spinner className="text-zinc-500" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-zinc-500">{t.palette.actionNoUser}</p>
      ) : (
        <div className="max-h-72 overflow-y-auto py-1">
          {candidates.map((u, i) => (
            <button
              key={u.accountId}
              className={`flex w-full items-center px-3 py-2 text-left text-sm text-zinc-200 ${
                i === activeIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
              }`}
              onMouseEnter={() => setRawActiveIndex(i)}
              onClick={() => runUser(u)}
            >
              {u.displayName}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function WorklogAction({
  action,
  onClose
}: {
  action: Extract<QuickAction, { kind: 'worklog' }>
  onClose: () => void
}): React.JSX.Element {
  const { phase, errorMessage, begin, succeed, fail } = useActionPhase(action.key, onClose)

  const run = (): void => {
    begin()
    void invoke('issues:logWork', {
      key: action.key,
      timeSpent: action.timeSpent,
      comment: action.comment ?? undefined
    })
      .then((res) => succeed(res.queued))
      .catch(fail)
  }

  useEffect(() => {
    if (phase !== 'idle') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        run()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <>
      <ActionHeader label={t.palette.actionWorklog} issueKey={action.key} />
      {phase !== 'idle' ? (
        <ActionStatus phase={phase} errorMessage={errorMessage} />
      ) : (
        <button
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/60"
          onClick={run}
        >
          <span className="min-w-0 flex-1 truncate">
            {t.palette.actionWorklog} {action.timeSpent} em {action.key}
            {action.comment ? ` — "${action.comment}"` : ''}
          </span>
          <span className="shrink-0 text-xs text-zinc-500">{t.palette.actionRun}</span>
        </button>
      )}
    </>
  )
}

function CommentAction({
  action,
  onClose
}: {
  action: Extract<QuickAction, { kind: 'comment' }>
  onClose: () => void
}): React.JSX.Element {
  const { phase, errorMessage, begin, succeed, fail } = useActionPhase(action.key, onClose)

  const run = (): void => {
    begin()
    void invoke('issues:comment', { issueKey: action.key, body: action.body })
      .then((res) => succeed(res.queued))
      .catch(fail)
  }

  useEffect(() => {
    if (phase !== 'idle') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        run()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <>
      <ActionHeader label={t.palette.actionComment} issueKey={action.key} />
      {phase !== 'idle' ? (
        <ActionStatus phase={phase} errorMessage={errorMessage} />
      ) : (
        <button
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/60"
          onClick={run}
        >
          <span className="min-w-0 flex-1 truncate">
            {t.palette.actionComment} {action.key}: &quot;{action.body}&quot;
          </span>
          <span className="shrink-0 text-xs text-zinc-500">{t.palette.actionRun}</span>
        </button>
      )}
    </>
  )
}

/** Painel de ação rápida — substitui os resultados de busca quando `query` casa
 * com um verbo reconhecido por `parseQuickAction`. Cada kind vira um componente
 * próprio para o TS estreitar o union sem casts. */
function ActionMode({
  action,
  onClose
}: {
  action: QuickAction
  onClose: () => void
}): React.JSX.Element {
  switch (action.kind) {
    case 'move':
      return <MoveAction action={action} onClose={onClose} />
    case 'assign':
      return <AssignAction action={action} onClose={onClose} />
    case 'worklog':
      return <WorklogAction action={action} onClose={onClose} />
    case 'comment':
      return <CommentAction action={action} onClose={onClose} />
  }
}

function PaletteModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rawActiveIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { openIssue } = useIssueDetail()
  const navigate = useNavigate()

  const quickAction = parseQuickAction(query)
  // verbo digitado mas comando incompleto ("mover", "mover BT-8…") → mostra a
  // sintaxe em vez de cair na busca comum, como o "criar " já faz
  const partialVerb = quickAction === null ? quickActionVerb(query) : null

  // Com uma ação rápida reconhecida (ou em digitação), a busca global não roda
  // (nem os resultados dela aparecem) — o painel de ação toma o lugar da lista.
  const { data, isFetching } = useGlobalSearch(quickAction || partialVerb ? '' : query)
  const results = data?.results ?? []
  const activeIndex = Math.min(rawActiveIndex, Math.max(results.length - 1, 0))

  // "criar <ideia>" (ou ">ideia") atalha direto para a criação de card, sem passar pela busca.
  const createIdea = query.toLowerCase().startsWith('criar ')
    ? query.slice(6)
    : query.startsWith('>')
      ? query.slice(1)
      : null
  const trimmedCreateIdea = createIdea?.trim() ?? ''

  const goCreate = (): void => {
    if (!trimmedCreateIdea) return
    navigate(`/criar?idea=${encodeURIComponent(trimmedCreateIdea)}`)
    onClose()
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const openResult = (key: string): void => {
    openIssue(key)
    onClose()
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (createIdea !== null) {
      if (e.key === 'Enter') {
        e.preventDefault()
        goCreate()
      }
      return
    }
    if (quickAction !== null) {
      // navegação (↑↓) e execução (Enter) do painel de ação são tratadas pelo
      // próprio ActionMode via listener global de keydown.
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex]
      if (!target) return
      if (e.metaKey || e.ctrlKey) {
        void invoke('shell:openIssue', { issueKey: target.key })
        onClose()
      } else {
        openResult(target.key)
      }
    }
  }

  const trimmed = query.trim()

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="mx-auto mt-24 w-[640px] max-w-[90vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <Search size={14} className="shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            placeholder={t.palette.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {isFetching && createIdea === null && quickAction === null && (
            <Spinner className="shrink-0 text-zinc-500" />
          )}
        </div>

        <div className="max-h-96 overflow-y-auto py-1">
          {createIdea !== null ? (
            trimmedCreateIdea.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-zinc-500">Digite a ideia do card…</p>
            ) : (
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/60"
                onClick={goCreate}
              >
                <Plus size={14} className="shrink-0 text-indigo-400 light:text-indigo-600" />
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                  Criar card: &quot;{trimmedCreateIdea}&quot;
                </span>
              </button>
            )
          ) : quickAction !== null ? (
            <ActionMode action={quickAction} onClose={onClose} />
          ) : partialVerb !== null ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-zinc-400">{t.palette.actionUsage[partialVerb].syntax}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {t.palette.actionUsage[partialVerb].example}
              </p>
            </div>
          ) : trimmed.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-zinc-500">{t.palette.emptyHint}</p>
              <p className="mt-1 text-xs text-zinc-600">
                &quot;criar &lt;ideia&gt;&quot; abre a criação de card
              </p>
              <p className="mt-1 text-xs text-zinc-600">{t.palette.actionHint}</p>
            </div>
          ) : trimmed.length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">{t.palette.minChars}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">{t.palette.noResults}</p>
          ) : (
            results.map((result, i) => (
              <button
                key={result.key}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${
                  i === activeIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => openResult(result.key)}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{result.key}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {result.summary}
                  </span>
                  {result.status && (
                    <Badge color={statusColor(result.statusCategory)}>{result.status}</Badge>
                  )}
                </div>
                {result.snippet && (
                  <p className="truncate pl-0 text-xs text-zinc-500">
                    {renderSnippet(result.snippet)}
                  </p>
                )}
              </button>
            ))
          )}
        </div>

        {results.length > 0 && createIdea === null && quickAction === null && (
          <div className="border-t border-zinc-800 px-3 py-1.5 text-xs text-zinc-600">
            {t.palette.hintOpen}
          </div>
        )}
      </div>
    </div>
  )
}
