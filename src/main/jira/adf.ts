import type { AdfNode } from './types'

/**
 * Converte Atlassian Document Format em texto plano legível.
 * Suficiente para descrição/comentários (parágrafos, listas, menções, código, links).
 */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return ''
  const out: string[] = []
  walk(node, out, 0)
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function walk(node: AdfNode, out: string[], listDepth: number): void {
  switch (node.type) {
    case 'text':
      out.push(node.text ?? '')
      return
    case 'mention':
      out.push(String(node.attrs?.text ?? '@?'))
      return
    case 'emoji':
      out.push(String(node.attrs?.shortName ?? ''))
      return
    case 'hardBreak':
      out.push('\n')
      return
    case 'inlineCard':
      out.push(String(node.attrs?.url ?? ''))
      return
    case 'rule':
      out.push('\n---\n')
      return
    case 'codeBlock': {
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      out.push('\n```\n' + code + '\n```\n')
      return
    }
    case 'paragraph':
    case 'heading': {
      children(node, out, listDepth)
      out.push('\n')
      return
    }
    case 'bulletList':
    case 'orderedList': {
      children(node, out, listDepth + 1)
      if (listDepth === 0) out.push('\n')
      return
    }
    case 'listItem': {
      out.push(`${'  '.repeat(Math.max(0, listDepth - 1))}- `)
      // conteúdo do item sem quebra dupla
      const inner: string[] = []
      children(node, inner, listDepth)
      out.push(inner.join('').replace(/\n+$/, '') + '\n')
      return
    }
    case 'blockquote': {
      const inner: string[] = []
      children(node, inner, listDepth)
      out.push(
        inner
          .join('')
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => `> ${l}`)
          .join('\n') + '\n'
      )
      return
    }
    case 'table':
    case 'tableRow': {
      children(node, out, listDepth)
      if (node.type === 'tableRow') out.push('\n')
      return
    }
    case 'tableCell':
    case 'tableHeader': {
      const inner: string[] = []
      children(node, inner, listDepth)
      out.push(inner.join('').replace(/\n+$/, '') + ' | ')
      return
    }
    case 'mediaGroup':
    case 'mediaSingle':
    case 'media':
      out.push('[anexo]')
      return
    default:
      children(node, out, listDepth)
  }
}

function children(node: AdfNode, out: string[], listDepth: number): void {
  for (const child of node.content ?? []) walk(child, out, listDepth)
}

/**
 * Coleta os accountIds mencionados num ADF (nós `type: 'mention'`, `attrs.id`).
 * Sem duplicatas, na ordem de aparição.
 */
export function collectMentionAccountIds(node: AdfNode | null | undefined): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  walkMentions(node, ids, seen)
  return ids
}

function walkMentions(node: AdfNode | null | undefined, ids: string[], seen: Set<string>): void {
  if (!node) return
  if (node.type === 'mention') {
    const id = node.attrs?.id
    if (typeof id === 'string' && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  for (const child of node.content ?? []) walkMentions(child, ids, seen)
}

const HEADING_RE = /^(#{1,6}) (.*)$/
// `- [ ] texto` / `- [x] texto` (x case-insensitive); texto opcional
const TASK_RE = /^- \[([ xX])\](?:\s+(.*))?$/
// `- texto` / `* texto` (checar TASK_RE antes: taskItem também casa aqui)
const BULLET_RE = /^[-*] (.*)$/

/**
 * Converte texto simples (subconjunto de markdown) em ADF para o corpo da issue.
 * Suporta: headings `#`..`######`, task lists `- [ ]`/`- [x]`, bullet lists `-`/`*`,
 * parágrafos (linhas normais unidas por hardBreak) e negrito `**...**`.
 * Especificação congelada — não estender sem alinhar com os testes.
 */
export function textToAdf(text: string): AdfNode {
  if (text.trim() === '') return { type: 'doc', version: 1, content: [] }

  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const content: AdfNode[] = []
  let localId = 1
  const nextId = (): string => String(localId++)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line === '') {
      i++
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: inline(heading[2])
      })
      i++
      continue
    }

    if (TASK_RE.test(line)) {
      const listId = nextId()
      const items: AdfNode[] = []
      for (; i < lines.length; i++) {
        const m = TASK_RE.exec(lines[i])
        if (!m) break
        items.push({
          type: 'taskItem',
          attrs: { localId: nextId(), state: m[1] === ' ' ? 'TODO' : 'DONE' },
          content: inline(m[2] ?? '')
        })
      }
      content.push({ type: 'taskList', attrs: { localId: listId }, content: items })
      continue
    }

    if (BULLET_RE.test(line)) {
      const items: AdfNode[] = []
      for (; i < lines.length; i++) {
        // taskItems têm prioridade — não absorvê-los como bullets
        if (TASK_RE.test(lines[i])) break
        const m = BULLET_RE.exec(lines[i])
        if (!m) break
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(m[1]) }] })
      }
      content.push({ type: 'bulletList', content: items })
      continue
    }

    // parágrafo: linhas normais consecutivas unidas por hardBreak
    const paraContent: AdfNode[] = []
    let first = true
    for (; i < lines.length; i++) {
      const l = lines[i]
      if (l === '' || HEADING_RE.test(l) || TASK_RE.test(l) || BULLET_RE.test(l)) break
      if (!first) paraContent.push({ type: 'hardBreak' })
      paraContent.push(...inline(l))
      first = false
    }
    content.push({ type: 'paragraph', content: paraContent })
  }

  return { type: 'doc', version: 1, content }
}

/**
 * Inline marks: só negrito via `**...**`. Empareja apenas pares completos
 * (regex) — `**` sem par vira texto literal; segmentos vazios são omitidos.
 */
function inline(s: string): AdfNode[] {
  const nodes: AdfNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      const plain = s.slice(last, m.index)
      if (plain) nodes.push({ type: 'text', text: plain })
    }
    if (m[1]) nodes.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] })
    last = m.index + m[0].length
  }
  if (last < s.length) {
    const plain = s.slice(last)
    if (plain) nodes.push({ type: 'text', text: plain })
  }
  return nodes
}
