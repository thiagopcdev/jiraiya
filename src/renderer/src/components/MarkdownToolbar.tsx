import { useEffect, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  SquareCode,
  Sparkles,
  Loader2
} from 'lucide-react'
import { invoke, IpcError } from '../api/client'
import { t } from '../strings/ptBR'

interface EditResult {
  next: string
  selStart: number
  selEnd: number
}

interface Selection {
  value: string
  start: number
  end: number
}

/** Envolve a seleção (ou um placeholder, se vazia) com o mesmo marcador nos dois lados. */
function wrapInline(sel: Selection, marker: string, placeholder = 'texto'): EditResult {
  const { value, start, end } = sel
  const hasSelection = start !== end
  const text = hasSelection ? value.slice(start, end) : placeholder
  const next = value.slice(0, start) + marker + text + marker + value.slice(end)
  const selStart = start + marker.length
  const selEnd = selStart + text.length
  return { next, selStart, selEnd }
}

/** `[seleção](url)` — com seleção, o texto do link já sai preenchido e 'url' fica selecionado
 * para digitar por cima; sem seleção, insere `[texto](url)` selecionando 'texto'. */
function applyLink(sel: Selection): EditResult {
  const { value, start, end } = sel
  const hasSelection = start !== end
  if (hasSelection) {
    const label = value.slice(start, end)
    const next = value.slice(0, start) + `[${label}](url)` + value.slice(end)
    const urlStart = start + label.length + 3 // '[' + label + ']('
    return { next, selStart: urlStart, selEnd: urlStart + 3 }
  }
  const placeholder = 'texto'
  const next = value.slice(0, start) + `[${placeholder}](url)` + value.slice(end)
  const textStart = start + 1 // '['
  return { next, selStart: textStart, selEnd: textStart + placeholder.length }
}

/** Encontra os limites (índices) das linhas completas que cobrem a seleção atual. */
function getLineRange(
  value: string,
  start: number,
  end: number
): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  let lineEnd = value.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = value.length
  return { lineStart, lineEnd }
}

/**
 * Toggle genérico de prefixo por linha: se todas as linhas não-vazias da seleção já têm
 * o prefixo, remove de todas; senão, adiciona nas que ainda não têm (linhas vazias ficam
 * intactas).
 */
function toggleLinePrefix(
  sel: Selection,
  hasPrefix: (line: string) => boolean,
  addPrefix: (line: string) => string,
  removePrefix: (line: string) => string
): EditResult {
  const { value, start, end } = sel
  const { lineStart, lineEnd } = getLineRange(value, start, end)
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const nonEmpty = lines.filter((l) => l.length > 0)
  const allHavePrefix = nonEmpty.length > 0 && nonEmpty.every(hasPrefix)
  const transformed = lines.map((line) => {
    if (line.length === 0) return line
    if (allHavePrefix) return removePrefix(line)
    return hasPrefix(line) ? line : addPrefix(line)
  })
  const newBlock = transformed.join('\n')
  const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)
  return { next, selStart: lineStart, selEnd: lineStart + newBlock.length }
}

const ORDERED_LIST_RE = /^\d+\.\s/
const CHECKLIST_RE = /^- \[[ xX]\] /

/** Toggle simples: se já numerado, remove o `N. ` de cada linha; senão, numera 1., 2., 3'… */
function toggleOrderedList(sel: Selection): EditResult {
  const { value, start, end } = sel
  const { lineStart, lineEnd } = getLineRange(value, start, end)
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const nonEmpty = lines.filter((l) => l.length > 0)
  const allNumbered = nonEmpty.length > 0 && nonEmpty.every((l) => ORDERED_LIST_RE.test(l))
  let counter = 1
  const transformed = lines.map((line) => {
    if (line.length === 0) return line
    if (allNumbered) return line.replace(ORDERED_LIST_RE, '')
    return `${counter++}. ${line}`
  })
  const newBlock = transformed.join('\n')
  const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)
  return { next, selStart: lineStart, selEnd: lineStart + newBlock.length }
}

/** Envolve as linhas selecionadas com ``` acima e abaixo. */
function wrapCodeBlock(sel: Selection): EditResult {
  const { value, start, end } = sel
  const { lineStart, lineEnd } = getLineRange(value, start, end)
  const block = value.slice(lineStart, lineEnd)
  const newBlock = '```\n' + block + '\n```'
  const next = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)
  return { next, selStart: lineStart, selEnd: lineStart + newBlock.length }
}

interface ToolbarButton {
  key: string
  icon: typeof Bold
  title: string
  run: (sel: Selection) => EditResult
}

const buttons: ToolbarButton[] = [
  { key: 'bold', icon: Bold, title: 'Negrito (Cmd+B)', run: (sel) => wrapInline(sel, '**') },
  { key: 'italic', icon: Italic, title: 'Itálico (Cmd+I)', run: (sel) => wrapInline(sel, '*') },
  {
    key: 'strike',
    icon: Strikethrough,
    title: 'Riscado',
    run: (sel) => wrapInline(sel, '~~')
  },
  { key: 'code', icon: Code, title: 'Código', run: (sel) => wrapInline(sel, '`') },
  { key: 'link', icon: Link, title: 'Link (Cmd+K)', run: applyLink }
]

const lineButtons: ToolbarButton[] = [
  {
    key: 'heading',
    icon: Heading2,
    title: 'Título',
    run: (sel) =>
      toggleLinePrefix(
        sel,
        (l) => l.startsWith('## '),
        (l) => '## ' + l,
        (l) => l.slice(3)
      )
  },
  {
    key: 'list',
    icon: List,
    title: 'Lista',
    run: (sel) =>
      toggleLinePrefix(
        sel,
        (l) => l.startsWith('- '),
        (l) => '- ' + l,
        (l) => l.slice(2)
      )
  },
  {
    key: 'ordered-list',
    icon: ListOrdered,
    title: 'Lista numerada',
    run: toggleOrderedList
  },
  {
    key: 'checklist',
    icon: ListChecks,
    title: 'Checklist',
    run: (sel) =>
      toggleLinePrefix(
        sel,
        (l) => CHECKLIST_RE.test(l),
        (l) => '- [ ] ' + l,
        (l) => l.replace(CHECKLIST_RE, '')
      )
  },
  {
    key: 'quote',
    icon: Quote,
    title: 'Citação',
    run: (sel) =>
      toggleLinePrefix(
        sel,
        (l) => l.startsWith('> '),
        (l) => '> ' + l,
        (l) => l.slice(2)
      )
  },
  {
    key: 'code-block',
    icon: SquareCode,
    title: 'Bloco de código',
    run: wrapCodeBlock
  }
]

const buttonClass = 'rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'

/**
 * Barra de formatação markdown reutilizável para textareas controlados. Opera direto sobre
 * o DOM do textarea (via ref) para ler a seleção atual, delega a transformação a helpers
 * puros e restaura foco+seleção depois do onChange (o value é controlado, então a seleção
 * se perde no re-render se não for restaurada explicitamente).
 */
export function MarkdownToolbar({
  textareaRef,
  value,
  onChange,
  aiContext
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
  /** habilita o botão "Formatar com IA"; define o tom (descrição × comentário) */
  aiContext?: 'description' | 'comment'
}): React.JSX.Element {
  const { data: claudeStatus } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {}),
    staleTime: 5 * 60_000
  })
  const [polishBusy, setPolishBusy] = useState(false)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)

  // Some sozinho após alguns segundos, sem exigir interação do usuário.
  useEffect(() => {
    if (!polishError) return
    const timer = setTimeout(() => setPolishError(null), 5000)
    return () => clearTimeout(timer)
  }, [polishError])

  const runButton = (btn: ToolbarButton): void => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const result = btn.run({ value, start, end })
    onChange(result.next)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(result.selStart, result.selEnd)
    })
  }

  const runPolish = async (): Promise<void> => {
    if (!aiContext || polishBusy || !value.trim()) return
    setPolishBusy(true)
    setPolishError(null)
    try {
      const res = await invoke('text:polish', { text: value, context: aiContext })
      setPrevious(value)
      onChange(res.text)
    } catch (err) {
      setPolishError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setPolishBusy(false)
    }
  }

  const undoPolish = (): void => {
    if (previous === null) return
    onChange(previous)
    setPrevious(null)
  }

  const renderButton = (btn: ToolbarButton): React.JSX.Element => {
    const Icon = btn.icon
    return (
      <button
        key={btn.key}
        type="button"
        className={buttonClass}
        title={btn.title}
        aria-label={btn.title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => runButton(btn)}
      >
        <Icon size={14} />
      </button>
    )
  }

  const showPolish = Boolean(aiContext) && claudeStatus?.available

  return (
    <div className="mb-1 flex items-center gap-0.5">
      {buttons.map(renderButton)}
      <div className="mx-1 h-4 border-l border-zinc-700" />
      {lineButtons.map(renderButton)}
      {showPolish && (
        <>
          <div className="mx-1 h-4 border-l border-zinc-700" />
          <button
            type="button"
            className={`rounded p-1 disabled:opacity-60 ${
              polishError
                ? 'text-amber-400 light:text-amber-600'
                : 'text-indigo-400 hover:bg-zinc-800 hover:text-indigo-300 light:hover:bg-zinc-200'
            }`}
            title={polishError ?? 'Formatar com IA — reescreve com formatação profissional'}
            aria-label="Formatar com IA"
            disabled={polishBusy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void runPolish()}
          >
            {polishBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          </button>
          {previous !== null && (
            <button
              type="button"
              className="text-xs text-zinc-500 hover:underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={undoPolish}
            >
              Desfazer
            </button>
          )}
          {polishError && (
            <span className="text-xs text-amber-400 light:text-amber-600">{polishError}</span>
          )}
        </>
      )}
    </div>
  )
}
