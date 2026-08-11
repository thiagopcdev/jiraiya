import { useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react'
import { useMentionPicker, type MentionUser } from './mentionPicker'
import type { MentionMap } from '../lib/mentionText'

/**
 * Quebra o texto nos nomes marcados. Nomes mais longos primeiro pelo mesmo
 * motivo do toMarkdown: "Ana" não pode consumir o começo de "Ana Lúcia".
 */
function segments(text: string, mentions: MentionMap): Array<{ text: string; mention: boolean }> {
  const names = Object.keys(mentions).sort((a, b) => b.length - a.length)
  if (names.length === 0) return [{ text, mention: false }]

  const out: Array<{ text: string; mention: boolean }> = []
  let plain = ''
  let i = 0
  const isBoundary = (char: string | undefined): boolean =>
    char === undefined || !/[\p{L}\p{N}]/u.test(char)

  while (i < text.length) {
    if (text[i] === '@' && isBoundary(text[i - 1])) {
      const name = names.find(
        (n) => text.startsWith(n, i + 1) && isBoundary(text[i + 1 + n.length])
      )
      if (name) {
        if (plain) {
          out.push({ text: plain, mention: false })
          plain = ''
        }
        out.push({ text: `@${name}`, mention: true })
        i += name.length + 1
        continue
      }
    }
    plain += text[i]
    i += 1
  }
  if (plain) out.push({ text: plain, mention: false })
  return out
}

/**
 * Textarea de markdown com menção "@" — a pessoa marcada aparece como pílula,
 * igual ao editor do Jira.
 *
 * Textarea não renderiza HTML, então a pílula vem de um espelho: uma camada
 * atrás com EXATAMENTE o mesmo texto e a mesma tipografia, onde a menção ganha
 * fundo arredondado; o textarea fica por cima com o texto transparente (só o
 * cursor e a seleção aparecem). Como o texto exibido é o mesmo dos dois lados —
 * "@Nome", sem accountId — o alinhamento é caractere a caractere.
 *
 * Por isso a pílula só pode pintar fundo e cor: qualquer padding empurraria o
 * texto do espelho e desalinharia do que está sendo digitado. O respiro vem de
 * `px-1 -mx-1`, que estica o fundo sem mexer na medida.
 */
export function MentionTextarea({
  className = '',
  value,
  onChange,
  textareaRef,
  initialMentions,
  onPick,
  ...rest
}: {
  className?: string
  value: string
  onChange: (next: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  initialMentions?: MentionMap
  onPick?: (user: MentionUser) => void
} & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'className' | 'ref'
>): React.JSX.Element {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? innerRef
  const mirrorRef = useRef<HTMLDivElement>(null)

  const mention = useMentionPicker({
    textareaRef: ref,
    value,
    onChange,
    initialMentions,
    onPick
  })

  // o espelho não rola sozinho: acompanha o textarea
  useLayoutEffect(() => {
    const el = ref.current
    const mirror = mirrorRef.current
    if (!el || !mirror) return
    const sync = (): void => {
      mirror.scrollTop = el.scrollTop
      mirror.scrollLeft = el.scrollLeft
    }
    sync()
    el.addEventListener('scroll', sync)
    return () => el.removeEventListener('scroll', sync)
  }, [ref, value])

  const parts = segments(value, mention.mentions)

  return (
    <div className="relative">
      <div
        ref={mirrorRef}
        aria-hidden
        className={`${className} pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap`}
      >
        {parts.map((part, i) =>
          part.mention ? (
            <span key={i} className="-mx-1 rounded bg-indigo-600/25 px-1 text-indigo-300">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
        {/* última linha vazia precisa de algo para ocupar altura */}
        {value.endsWith('\n') && <span>&nbsp;</span>}
      </div>
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...mention.textareaProps}
        // a seleção precisa ser translúcida: opaca, esconderia o espelho
        className={`${className} relative selection:bg-indigo-500/30`}
        // inline porque precisa ganhar do bg/text do className, e a ordem entre
        // duas utilities da mesma propriedade depende da folha, não da string
        style={{
          backgroundColor: 'transparent',
          color: 'transparent',
          caretColor: 'var(--tone-100)'
        }}
      />
      {mention.popover}
    </div>
  )
}

export { type MentionUser }
