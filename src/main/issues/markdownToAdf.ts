import type { AdfNode } from '../jira/types'

/**
 * Converte markdown básico em Atlassian Document Format (ADF).
 * Função pura, sem libs externas — especificação congelada (testes escritos
 * contra os exemplos normativos). NÃO estender sem alinhar com os testes.
 *
 * Suporta: headings, parágrafos (linhas contíguas unidas por espaço), listas
 * (bullet/ordered com UM nível de aninhamento por indentação de 2+ espaços),
 * task lists (`- [ ]` / `- [x]`), code fence, blockquote, régua (`---`/`***`)
 * e marcas inline
 * (**negrito**, *itálico* ou _itálico_, `código`, ~~riscado~~, [link](url)).
 */
export function markdownToAdf(markdown: string): AdfNode {
  if (markdown.trim() === '') return { type: 'doc', version: 1, content: [] }
  return {
    type: 'doc',
    version: 1,
    content: parseBlocks(markdown.split('\n'), { next: 1 })
  }
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const FENCE_RE = /^```(.*)$/
const RULE_RE = /^(-{3,}|\*{3,})$/
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/
const ORDERED_RE = /^(\s*)\d+\.\s+(.*)$/
// `- [ ] texto` / `* [x] texto` (x case-insensitive); texto opcional
const TASK_RE = /^\s*[-*]\s+\[([ xX])\](?:\s+(.*))?$/

/** Contador de localId do documento (taskList/taskItem), incremental a partir de 1. */
interface IdCounter {
  next: number
}

interface ListItemMatch {
  indent: number
  type: 'bullet' | 'ordered'
  text: string
}

interface TaskItemMatch {
  state: 'TODO' | 'DONE'
  text: string
}

function matchTaskItem(line: string): TaskItemMatch | null {
  const m = TASK_RE.exec(line)
  if (!m) return null
  return { state: m[1] === ' ' ? 'TODO' : 'DONE', text: m[2] ?? '' }
}

function matchListItem(line: string): ListItemMatch | null {
  // taskItems têm prioridade — não absorvê-los como bullets
  if (matchTaskItem(line)) return null
  const b = BULLET_RE.exec(line)
  if (b) return { indent: b[1].length, type: 'bullet', text: b[2] }
  const o = ORDERED_RE.exec(line)
  if (o) return { indent: o[1].length, type: 'ordered', text: o[2] }
  return null
}

function isBlockStart(line: string): boolean {
  return (
    line.trim() === '' ||
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    RULE_RE.test(line.trim()) ||
    /^>/.test(line) ||
    matchTaskItem(line) !== null ||
    matchListItem(line) !== null
  )
}

function parseBlocks(lines: string[], ids: IdCounter): AdfNode[] {
  const content: AdfNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    const fence = FENCE_RE.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // consome o fence de fechamento
      content.push({
        type: 'codeBlock',
        attrs: lang ? { language: lang } : {},
        content: [{ type: 'text', text: codeLines.join('\n') }]
      })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2])
      })
      i++
      continue
    }

    if (RULE_RE.test(line.trim())) {
      content.push({ type: 'rule' })
      i++
      continue
    }

    if (/^>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      content.push({ type: 'blockquote', content: paragraphsFrom(quoted) })
      continue
    }

    if (matchTaskItem(line)) {
      const { node, next } = parseTaskList(lines, i, ids)
      content.push(node)
      i = next
      continue
    }

    if (matchListItem(line)) {
      const { node, next } = parseList(lines, i)
      content.push(node)
      i = next
      continue
    }

    // parágrafo: linhas contíguas (não-bloco) unidas por espaço
    const paraLines: string[] = []
    while (i < lines.length && !isBlockStart(lines[i])) {
      paraLines.push(lines[i].trim())
      i++
    }
    content.push({ type: 'paragraph', content: parseInline(paraLines.join(' ')) })
  }

  return content
}

/** Agrupa linhas em parágrafos (contíguas → um parágrafo; linha em branco separa). */
function paragraphsFrom(lines: string[]): AdfNode[] {
  const paras: AdfNode[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      buf.push(lines[i].trim())
      i++
    }
    paras.push({ type: 'paragraph', content: parseInline(buf.join(' ')) })
  }
  return paras
}

/**
 * Task list a partir de `start`: itens `- [ ]`/`- [x]` consecutivos num único
 * taskList. localId é o contador do documento — o taskList recebe o id primeiro,
 * depois os itens em ordem. Sem aninhamento.
 */
function parseTaskList(
  lines: string[],
  start: number,
  ids: IdCounter
): { node: AdfNode; next: number } {
  const listId = String(ids.next++)
  const items: AdfNode[] = []
  let i = start

  while (i < lines.length) {
    const m = matchTaskItem(lines[i])
    if (!m) break
    items.push({
      type: 'taskItem',
      attrs: { localId: String(ids.next++), state: m.state },
      content: parseInline(m.text)
    })
    i++
  }

  return { node: { type: 'taskList', attrs: { localId: listId }, content: items }, next: i }
}

/**
 * Lista a partir de `start`. Agrupa itens consecutivos do mesmo tipo no nível
 * base (indent < 2); itens indentados 2+ formam UMA sublista dentro do item.
 */
function parseList(lines: string[], start: number): { node: AdfNode; next: number } {
  const first = matchListItem(lines[start])!
  const baseType = first.type
  const items: AdfNode[] = []
  let i = start

  while (i < lines.length) {
    const m = matchListItem(lines[i])
    if (!m || m.indent >= 2 || m.type !== baseType) break

    const itemContent: AdfNode[] = [{ type: 'paragraph', content: parseInline(m.text) }]
    i++

    // sublista (um nível): itens indentados 2+ até quebrar
    const nested: AdfNode[] = []
    let nestedType: 'bullet' | 'ordered' | null = null
    while (i < lines.length) {
      const nm = matchListItem(lines[i])
      if (!nm || nm.indent < 2) break
      if (nestedType === null) nestedType = nm.type
      if (nm.type !== nestedType) break
      nested.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInline(nm.text) }]
      })
      i++
    }
    if (nested.length > 0 && nestedType) {
      itemContent.push({
        type: nestedType === 'bullet' ? 'bulletList' : 'orderedList',
        content: nested
      })
    }

    items.push({ type: 'listItem', content: itemContent })
  }

  return {
    node: { type: baseType === 'bullet' ? 'bulletList' : 'orderedList', content: items },
    next: i
  }
}

/**
 * Marcas inline. Ordem de teste por posição: código > **negrito** > ~~riscado~~
 * > *itálico* ou _itálico_ > [link](url). Marca sem fechamento → texto literal.
 */
function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = []
  let buffer = ''
  let i = 0

  const flush = (): void => {
    if (buffer) {
      nodes.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  while (i < text.length) {
    // `código` — conteúdo literal, sem parse interno
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'text', text: text.slice(i + 1, end), marks: [{ type: 'code' }] })
        i = end + 1
        continue
      }
    }

    // **negrito**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'text', text: text.slice(i + 2, end), marks: [{ type: 'strong' }] })
        i = end + 2
        continue
      }
    }

    // ~~riscado~~
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'text', text: text.slice(i + 2, end), marks: [{ type: 'strike' }] })
        i = end + 2
        continue
      }
    }

    // *itálico*
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({ type: 'text', text: text.slice(i + 1, end), marks: [{ type: 'em' }] })
        i = end + 1
        continue
      }
    }

    // _itálico_
    if (text[i] === '_') {
      const end = text.indexOf('_', i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({ type: 'text', text: text.slice(i + 1, end), marks: [{ type: 'em' }] })
        i = end + 1
        continue
      }
    }

    // [texto](url)
    if (text[i] === '[') {
      const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(text.slice(i))
      if (m) {
        flush()
        nodes.push({
          type: 'text',
          text: m[1],
          marks: [{ type: 'link', attrs: { href: m[2] } }]
        })
        i += m[0].length
        continue
      }
    }

    buffer += text[i]
    i++
  }

  flush()
  return nodes
}
