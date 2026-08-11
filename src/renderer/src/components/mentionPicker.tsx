import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '../api/client'
import { pruneMentions, toMarkdown, type MentionMap } from '../lib/mentionText'

export interface MentionUser {
  accountId: string
  displayName: string
}

/**
 * Token de menção em aberto: um "@" no começo da linha ou depois de espaço,
 * seguido de até 40 caracteres sem espaço. Limitar o tamanho evita que um "@"
 * solto lá atrás mantenha o menu aberto enquanto se digita um parágrafo.
 */
const TOKEN_RE = /(^|\s)@([^\s@]{0,40})$/u

interface OpenToken {
  /** posição do "@" no texto */
  start: number
  /** o que já foi digitado depois do "@" */
  query: string
}

function findToken(value: string, caret: number): OpenToken | null {
  const match = TOKEN_RE.exec(value.slice(0, caret))
  if (!match) return null
  const query = match[2]
  return { start: caret - query.length - 1, query }
}

/**
 * Menu de "@" para um textarea de markdown.
 *
 * Devolve os handlers para espalhar no textarea e o popover pronto para
 * renderizar em qualquer lugar da árvore — ele se posiciona por
 * `position: fixed` a partir do retângulo do próprio textarea, então nenhum
 * compositor precisa ganhar wrapper ou mudar de layout para adotá-lo.
 */
export function useMentionPicker({
  textareaRef,
  value,
  onChange,
  disabled = false,
  initialMentions,
  onPick
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  /** o texto COMO O USUÁRIO VÊ: "@Nome", sem accountId */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** menções que já vieram no texto carregado (ver toDisplay) */
  initialMentions?: MentionMap
  /** avisa a escolha para quem guarda o mapa fora do hook (ex.: lista de subtasks) */
  onPick?: (user: MentionUser) => void
}): {
  textareaProps: {
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
    onSelect: () => void
    onBlur: () => void
  }
  popover: React.JSX.Element | null
  /** nome → accountId de quem está marcado agora (usado para pintar as pílulas) */
  mentions: MentionMap
  /** exibição → markdown com accountId; use ANTES de mandar para o Jira ou gravar rascunho */
  toMarkdown: (text: string) => string
} {
  // nome → accountId de quem foi escolhido no menu (ou veio no texto original).
  // Fica fora do texto justamente para o campo mostrar "@Nome" limpo. É estado,
  // não ref: a pílula precisa aparecer no mesmo instante da escolha.
  const [mentions, setMentions] = useState<MentionMap>({ ...initialMentions })
  const [token, setToken] = useState<OpenToken | null>(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  // um Enter que escolhe alguém não pode também disparar o "enviar" do
  // compositor; a marca sobrevive ao handler do dono, que roda logo depois
  const consumedRef = useRef(false)

  const open = token !== null && !disabled

  const { data } = useQuery({
    queryKey: ['users-search', token?.query ?? ''],
    queryFn: () => invoke('users:search', { query: token?.query ?? '' }),
    enabled: open,
    staleTime: 60_000
  })
  const users = open ? (data?.users ?? []) : []

  const close = useCallback((): void => {
    setToken(null)
    setIndex(0)
  }, [])

  /** relê o token a partir da posição atual do cursor */
  const refresh = useCallback((): void => {
    const el = textareaRef.current
    if (!el || disabled) return close()
    const next = findToken(el.value, el.selectionStart ?? 0)
    setToken((prev) => {
      if (next && (!prev || prev.start !== next.start || prev.query !== next.query)) {
        setIndex(0)
        return next
      }
      return next
    })
    if (next) setRect(el.getBoundingClientRect())
  }, [close, disabled, textareaRef])

  // o valor muda por digitação, colagem, template, botão da barra de formatação
  useEffect(refresh, [value, refresh])

  // rolar ou redimensionar move o textarea: o popover fixo tem de acompanhar
  useEffect(() => {
    if (!open) return
    const sync = (): void => {
      const el = textareaRef.current
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [open, textareaRef])

  const pick = (user: MentionUser): void => {
    const el = textareaRef.current
    if (!el || !token) return
    const caret = el.selectionStart ?? 0
    setMentions((prev) => ({ ...prev, [user.displayName]: user.accountId }))
    onPick?.(user)
    const inserted = `@${user.displayName} `
    onChange(value.slice(0, token.start) + inserted + value.slice(caret))
    close()
    // devolve o cursor para depois da menção; o setState do dono já rodou,
    // então o textarea só tem o texto novo no próximo frame
    const pos = token.start + inserted.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!open || users.length === 0) {
      // Esc fecha mesmo sem resultado (menu vazio ainda captura o "@" aberto)
      if (open && e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i + 1) % users.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i - 1 + users.length) % users.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      consumedRef.current = true
      pick(users[Math.min(index, users.length - 1)])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const popover =
    open && rect ? (
      <div
        role="listbox"
        aria-label="Sugestões de menção"
        className="fixed z-50 max-h-56 w-[260px] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-2xl"
        style={{
          left: rect.left,
          // abre para cima: o menu não cobre o que está sendo digitado
          bottom: window.innerHeight - rect.top + 6
        }}
      >
        {users.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-zinc-500">
            {data ? 'Ninguém encontrado' : 'Buscando…'}
          </p>
        ) : (
          users.map((user, i) => (
            <button
              key={user.accountId}
              type="button"
              role="option"
              aria-selected={i === index}
              // mousedown, não click: o clique tiraria o foco do textarea antes
              // de a escolha acontecer
              onMouseDown={(e) => {
                e.preventDefault()
                pick(user)
              }}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
                i === index ? 'bg-indigo-600/16 text-indigo-400' : 'text-zinc-300'
              }`}
            >
              <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-indigo-900 text-[9px] font-bold text-indigo-400">
                {initials(user.displayName)}
              </span>
              <span className="min-w-0 truncate">{user.displayName}</span>
            </button>
          ))
        )}
        {data?.offline && users.length > 0 && (
          <p className="border-t border-zinc-800 px-2 pt-1 pb-0.5 text-[10.5px] text-zinc-500">
            Sem conexão — quem o app já conhece
          </p>
        )}
      </div>
    ) : null

  return {
    mentions,
    // poda antes de converter: menção apagada do texto não pode voltar
    toMarkdown: (text: string) => toMarkdown(text, pruneMentions(text, mentions)),
    textareaProps: {
      onKeyDown,
      onSelect: refresh,
      onBlur: () => {
        // o mousedown do item roda antes do blur; fechar aqui direto cancelaria
        // a escolha pelo mouse
        if (consumedRef.current) {
          consumedRef.current = false
          return
        }
        setTimeout(close, 120)
      }
    },
    popover
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
