import type { AdfNode } from './types'
import { adfToText } from './adf'

/**
 * Converte Atlassian Document Format em markdown — o inverso de
 * `markdownToAdf` (src/main/issues/markdownToAdf.ts), para o editor de
 * descrição/comentário abrir com a formatação preservada.
 *
 * Função pura, sem libs externas — especificação congelada (testes escritos
 * contra os exemplos normativos, incluindo round-trip com markdownToAdf).
 * NÃO estender sem alinhar com os testes.
 *
 * Blocos suportados: paragraph, heading, bulletList/orderedList (UM nível de
 * aninhamento), taskList, codeBlock, blockquote, rule e mídia (`(anexo)`).
 * Qualquer outro bloco (panel, table, desconhecido) cai no fallback de texto
 * plano via `adfToText` — nunca lança.
 */
export function adfToMarkdown(node: AdfNode | null | undefined): string {
  if (!node) return ''
  const blocks = node.type === 'doc' ? (node.content ?? []) : [node]
  return blocks
    .map((block) => renderBlock(block))
    .filter((md) => md !== '')
    .join('\n\n')
}

function renderBlock(node: AdfNode): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content)

    case 'heading': {
      const level = headingLevel(node)
      return `${'#'.repeat(level)} ${renderInline(node.content)}`
    }

    case 'bulletList':
    case 'orderedList':
      return renderList(node).join('\n')

    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const box = String(item.attrs?.state ?? 'TODO') === 'DONE' ? '- [x] ' : '- [ ] '
          return (box + renderInline(item.content)).replace(/\s+$/, '')
        })
        .join('\n')

    case 'codeBlock': {
      const language = node.attrs?.language
      const fence = '```' + (typeof language === 'string' ? language : '')
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return `${fence}\n${code}\n\`\`\``
    }

    case 'blockquote': {
      const inner = (node.content ?? [])
        .map((child) => renderBlock(child))
        .filter((md) => md !== '')
        .join('\n\n')
      return inner
        .split('\n')
        .map((line) => `> ${line}`.replace(/\s+$/, ''))
        .join('\n')
    }

    case 'rule':
      return '---'

    case 'mediaGroup':
    case 'mediaSingle':
    case 'media':
      return '(anexo)'

    default:
      // panel, table e qualquer bloco desconhecido: texto plano, nunca lança
      return fallbackText(node)
  }
}

function fallbackText(node: AdfNode): string {
  try {
    return adfToText(node)
  } catch {
    return ''
  }
}

function headingLevel(node: AdfNode): number {
  const raw = node.attrs?.level
  const level = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(level)) return 1
  return Math.min(6, Math.max(1, Math.trunc(level)))
}

/** Linhas de uma lista (bullet/ordered), marcador sequencial nas ordenadas. */
function renderList(node: AdfNode, indent = ''): string[] {
  const ordered = node.type === 'orderedList'
  const lines: string[] = []
  let n = 1
  for (const item of node.content ?? []) {
    const marker = ordered ? `${n++}. ` : '- '
    lines.push(...renderListItem(item, marker, indent))
  }
  return lines
}

/**
 * Um listItem: primeiro bloco na linha do marcador; sublista (um nível) com
 * 2 espaços de indent; blocos extras alinhados sob o marcador.
 */
function renderListItem(item: AdfNode, marker: string, indent: string): string[] {
  const lines: string[] = []
  const children = item.content ?? []
  let first = true

  for (const child of children) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      lines.push(...renderList(child, indent + '  '))
      continue
    }
    const md = renderBlock(child)
    const firstPrefix = first ? indent + marker : indent + ' '.repeat(marker.length)
    // linhas seguintes (hardBreak, bloco multi-linha) alinham sob o marcador
    const contPrefix = indent + ' '.repeat(marker.length)
    md.split('\n').forEach((line, idx) => {
      lines.push(((idx === 0 ? firstPrefix : contPrefix) + line).replace(/\s+$/, ''))
    })
    first = false
  }

  if (lines.length === 0) lines.push((indent + marker).replace(/\s+$/, ''))
  return lines
}

function renderInline(content: AdfNode[] | undefined): string {
  return (content ?? []).map((child) => renderInlineNode(child)).join('')
}

function renderInlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks)

    case 'hardBreak':
      return '\n'

    case 'mention':
      return String(node.attrs?.text ?? '')

    case 'emoji':
      return String(node.attrs?.shortName ?? node.attrs?.text ?? node.text ?? '')

    case 'inlineCard':
      return String(node.attrs?.url ?? '')

    default:
      // nó inline desconhecido: texto próprio ou filhos
      if (node.content) return renderInline(node.content)
      return node.text ?? ''
  }
}

/**
 * Marcas do mais interno ao mais externo: code, strike, em, strong, link.
 * Marcas sem representação em markdown (underline, textColor…) são ignoradas.
 */
function applyMarks(text: string, marks: AdfNode['marks']): string {
  if (!marks || marks.length === 0) return text
  const has = (type: string): boolean => marks.some((m) => m?.type === type)
  let out = text
  if (has('code')) out = '`' + out + '`'
  if (has('strike')) out = '~~' + out + '~~'
  if (has('em')) out = '*' + out + '*'
  if (has('strong')) out = '**' + out + '**'
  const link = marks.find((m) => m?.type === 'link')
  if (link) out = `[${out}](${String(link.attrs?.href ?? '')})`
  return out
}
