import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { invoke } from '../api/client'
import { useGlobalSearch } from '../api/hooks'
import { Badge, Spinner } from './ui'
import { statusColor } from './statusColor'
import { useIssueDetail } from './issueDetail'
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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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

function PaletteModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rawActiveIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { openIssue } = useIssueDetail()
  const navigate = useNavigate()

  const { data, isFetching } = useGlobalSearch(query)
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
        className="mx-auto mt-24 w-[640px] max-w-[90vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            placeholder={t.palette.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          {isFetching && createIdea === null && <Spinner className="shrink-0 text-zinc-500" />}
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
          ) : trimmed.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-zinc-500">{t.palette.emptyHint}</p>
              <p className="mt-1 text-xs text-zinc-600">
                &quot;criar &lt;ideia&gt;&quot; abre a criação de card
              </p>
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

        {results.length > 0 && createIdea === null && (
          <div className="border-t border-zinc-800 px-3 py-1.5 text-xs text-zinc-600">
            {t.palette.hintOpen}
          </div>
        )}
      </div>
    </div>
  )
}
