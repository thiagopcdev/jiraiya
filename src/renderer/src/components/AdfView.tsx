import type { ReactNode } from 'react'

/**
 * Renderiza um documento ADF (Atlassian Document Format) com a formatação
 * essencial do Jira: parágrafos, negrito/itálico/código/links, listas
 * (bullet/numerada/tarefas), headings, citações, blocos de código, menções e
 * emojis. Nós desconhecidos degradam para o conteúdo interno (nunca quebram).
 */
interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

/** Resolver opcional pra nós de mídia (mediaSingle/mediaGroup) — ver `useMediaResolver` em attachments.tsx. */
type MediaResolver = (node: AdfNode) => ReactNode

export function AdfView({
  doc,
  mediaResolver
}: {
  doc: unknown
  mediaResolver?: MediaResolver
}): React.JSX.Element | null {
  const node = doc as AdfNode | null | undefined
  if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return null
  return (
    <div className="space-y-2 text-sm text-zinc-300">{renderChildren(node, mediaResolver)}</div>
  )
}

function renderChildren(node: AdfNode, mediaResolver?: MediaResolver): ReactNode {
  return (node.content ?? []).map((child, i) => (
    <AdfBlock key={i} node={child} mediaResolver={mediaResolver} />
  ))
}

function AdfBlock({
  node,
  mediaResolver
}: {
  node: AdfNode
  mediaResolver?: MediaResolver
}): React.JSX.Element | null {
  switch (node.type) {
    case 'paragraph':
      return <p className="min-h-4 leading-relaxed">{renderInline(node)}</p>
    case 'heading': {
      const level = Number(node.attrs?.level ?? 3)
      const sizes: Record<number, string> = {
        1: 'text-base font-bold',
        2: 'text-base font-semibold',
        3: 'text-sm font-semibold',
        4: 'text-sm font-semibold',
        5: 'text-sm font-medium',
        6: 'text-sm font-medium'
      }
      return <p className={`${sizes[level] ?? sizes[3]} text-zinc-100`}>{renderInline(node)}</p>
    }
    case 'bulletList':
      return <ul className="list-disc space-y-1 pl-5">{renderChildren(node, mediaResolver)}</ul>
    case 'orderedList':
      return <ol className="list-decimal space-y-1 pl-5">{renderChildren(node, mediaResolver)}</ol>
    case 'listItem':
      return <li>{renderChildren(node, mediaResolver)}</li>
    case 'taskList':
      return <div className="space-y-1">{renderChildren(node, mediaResolver)}</div>
    case 'taskItem': {
      const done = node.attrs?.state === 'DONE'
      return (
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={done} readOnly className="mt-1 accent-indigo-600" />
          <span className={done ? 'text-zinc-500 line-through' : ''}>{renderInline(node)}</span>
        </div>
      )
    }
    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-zinc-700 pl-3 text-zinc-400">
          {renderChildren(node, mediaResolver)}
        </blockquote>
      )
    case 'codeBlock':
      return (
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900 p-2.5 font-mono text-xs text-zinc-300">
          {(node.content ?? []).map((c) => c.text ?? '').join('')}
        </pre>
      )
    case 'rule':
      return <hr className="border-zinc-800" />
    case 'mediaSingle':
    case 'mediaGroup': {
      const rendered = mediaResolver?.(node)
      if (rendered != null) return <>{rendered}</>
      return <p className="text-xs text-zinc-600 italic">[anexo/imagem — ver no Jira]</p>
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <tbody>{renderChildren(node, mediaResolver)}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr className="border-b border-zinc-800">{renderChildren(node, mediaResolver)}</tr>
    case 'tableHeader':
      return (
        <th className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-left font-semibold">
          {renderChildren(node, mediaResolver)}
        </th>
      )
    case 'tableCell':
      return (
        <td className="border border-zinc-800 px-2 py-1 align-top">
          {renderChildren(node, mediaResolver)}
        </td>
      )
    case 'panel':
      return (
        <div className="rounded-md border border-zinc-700 bg-zinc-900/70 p-2.5">
          {renderChildren(node, mediaResolver)}
        </div>
      )
    default:
      // desconhecido: degrada para o conteúdo interno (ou inline, se for folha)
      if (node.content?.length) return <div>{renderChildren(node, mediaResolver)}</div>
      return <>{renderInline({ type: 'paragraph', content: [node] })}</>
  }
}

function renderInline(node: AdfNode): ReactNode {
  return (node.content ?? []).map((child, i) => <AdfInline key={i} node={child} />)
}

function AdfInline({ node }: { node: AdfNode }): React.JSX.Element | null {
  switch (node.type) {
    case 'text':
      return <>{applyMarks(node.text ?? '', node.marks)}</>
    case 'hardBreak':
      return <br />
    case 'mention':
      return (
        <span className="rounded bg-indigo-950/70 px-1 py-0.5 text-indigo-300">
          {String(node.attrs?.text ?? '@?')}
        </span>
      )
    case 'emoji':
      return <>{String(node.attrs?.text ?? node.attrs?.shortName ?? '')}</>
    case 'inlineCard':
      return (
        <a
          className="text-indigo-400 hover:underline"
          href={String(node.attrs?.url ?? '#')}
          target="_blank"
          rel="noreferrer"
        >
          {String(node.attrs?.url ?? 'link')}
        </a>
      )
    case 'status':
      return (
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-zinc-300 uppercase">
          {String(node.attrs?.text ?? '')}
        </span>
      )
    case 'date': {
      const ts = Number(node.attrs?.timestamp ?? 0)
      return <>{ts ? new Date(ts).toLocaleDateString('pt-BR') : ''}</>
    }
    default:
      if (node.text) return <>{node.text}</>
      if (node.content?.length) return <>{renderInline(node)}</>
      return null
  }
}

function applyMarks(text: string, marks?: AdfNode['marks']): ReactNode {
  let out: ReactNode = text
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'strong':
        out = <strong className="font-semibold text-zinc-100">{out}</strong>
        break
      case 'em':
        out = <em>{out}</em>
        break
      case 'strike':
        out = <s className="text-zinc-500">{out}</s>
        break
      case 'underline':
        out = <u>{out}</u>
        break
      case 'code':
        out = (
          <code className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-xs text-amber-200">
            {out}
          </code>
        )
        break
      case 'link':
        out = (
          <a
            className="text-indigo-400 hover:underline"
            href={String(mark.attrs?.href ?? '#')}
            target="_blank"
            rel="noreferrer"
          >
            {out}
          </a>
        )
        break
      case 'textColor':
        // cor customizada do Jira: mantém legível no tema escuro, só destaca
        out = <span className="text-zinc-100">{out}</span>
        break
    }
  }
  return out
}
