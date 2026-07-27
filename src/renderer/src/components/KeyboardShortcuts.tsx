import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { t } from '../strings/ptBR'

const SEQUENCE_TIMEOUT_MS = 1200

/** g+X — segunda tecla da sequência → rota de destino. */
const G_ROUTES: Record<string, string> = {
  d: '/',
  q: '/quadro',
  e: '/epicos',
  p: '/perguntar',
  f: '/filtros',
  c: '/criar',
  v: '/dividir',
  l: '/timeline',
  m: '/mencoes',
  r: '/resumos',
  t: '/time',
  a: '/alertas',
  s: '/config'
}

const G_SHORTCUTS: Array<[string, string]> = [
  ['g d', t.nav.dashboard],
  ['g q', t.nav.board],
  ['g e', t.nav.epics],
  ['g p', t.nav.ask],
  ['g f', t.nav.filters],
  ['g c', t.nav.create],
  ['g v', t.nav.split],
  ['g l', t.nav.timeline],
  ['g m', t.nav.mentions],
  ['g r', t.nav.summaries],
  ['g t', t.nav.team],
  ['g a', t.nav.alerts],
  ['g s', t.nav.settings]
]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** Sem UI própria (fora do modal de ajuda): listener global de atalhos de teclado —
 * sequências g+X para navegação, j/k/Enter para percorrer listas de cards e ? para ajuda. */
export default function KeyboardShortcuts(): React.JSX.Element | null {
  const navigate = useNavigate()
  const location = useLocation()
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingGRef = useRef(false)
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowIndexRef = useRef(-1)

  // Reset da navegação j/k ao trocar de tela.
  useEffect(() => {
    rowIndexRef.current = -1
  }, [location.pathname])

  useEffect(() => {
    const clearPendingG = (): void => {
      pendingGRef.current = false
      if (pendingGTimerRef.current) {
        clearTimeout(pendingGTimerRef.current)
        pendingGTimerRef.current = null
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      // '?' (shift+/) alterna o modal de ajuda.
      if (e.key === '?') {
        e.preventDefault()
        clearPendingG()
        setHelpOpen((v) => !v)
        return
      }

      if (e.key === 'Escape') {
        if (helpOpen) {
          e.preventDefault()
          setHelpOpen(false)
        }
        clearPendingG()
        return
      }

      // Com a ajuda aberta, só Esc/? interagem — o resto é ignorado.
      if (helpOpen) return

      // Segunda tecla de uma sequência g+X pendente.
      if (pendingGRef.current) {
        clearPendingG()
        const to = G_ROUTES[e.key.toLowerCase()]
        if (to) {
          e.preventDefault()
          void navigate(to)
        }
        return
      }
      if (e.key === 'g') {
        pendingGRef.current = true
        pendingGTimerRef.current = setTimeout(clearPendingG, SEQUENCE_TIMEOUT_MS)
        return
      }

      // j/k — navegação por linhas de card na tela atual. Ignora se a gaveta estiver aberta
      // (nunca casa se nenhum outro componente marcar o atributo — checagem apenas defensiva).
      if (e.key === 'j' || e.key === 'k') {
        if (document.querySelector('[data-drawer-open]')) return
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-kb-row]'))
        if (rows.length === 0) return

        const current = rowIndexRef.current
        const currentEl = current >= 0 ? rows[current] : undefined
        const stillMounted = currentEl ? document.contains(currentEl) : false

        let nextIndex: number
        if (!stillMounted) {
          nextIndex = 0
        } else if (e.key === 'j') {
          nextIndex = Math.min(current + 1, rows.length - 1)
        } else {
          nextIndex = Math.max(current - 1, 0)
        }

        rowIndexRef.current = nextIndex
        const target = rows[nextIndex]
        e.preventDefault()
        target.focus()
        target.scrollIntoView({ block: 'nearest' })
        return
      }

      if (e.key === 'Enter') {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-kb-row]'))
        const current = rowIndexRef.current
        const target = current >= 0 ? rows[current] : undefined
        if (target && document.activeElement === target) {
          e.preventDefault()
          target.click()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearPendingG()
    }
  }, [navigate, helpOpen])

  if (!helpOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setHelpOpen(false)}>
      <div
        className="mx-auto mt-24 w-[560px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-zinc-100">Atalhos de teclado</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Navegação
            </h3>
            <ul className="space-y-1 text-zinc-300">
              {G_SHORTCUTS.map(([keys, label]) => (
                <li key={keys} className="flex items-center gap-2">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    {keys}
                  </kbd>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Listas
              </h3>
              <ul className="space-y-1 text-zinc-300">
                <li className="flex items-center gap-2">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    j
                  </kbd>
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    k
                  </kbd>
                  <span>Avançar / voltar card</span>
                </li>
                <li className="flex items-center gap-2">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    Enter
                  </kbd>
                  <span>Abrir card selecionado</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Busca
              </h3>
              <ul className="space-y-1 text-zinc-300">
                <li className="flex items-center gap-2">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    ⌘K
                  </kbd>
                  <span>Busca rápida</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Fechar
              </h3>
              <ul className="space-y-1 text-zinc-300">
                <li className="flex items-center gap-2">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    Esc
                  </kbd>
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                    ?
                  </kbd>
                  <span>Fechar esta ajuda</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
