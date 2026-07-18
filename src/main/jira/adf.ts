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
