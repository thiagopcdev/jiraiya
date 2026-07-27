import { useIssueDetail } from './issueDetail'

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g
const BOLD_RE = /\*\*(.+?)\*\*/g

/** Quebra um trecho de texto em pedaços, transformando keys de issue (ex.: BT-123) em botões inline. */
function linkifyIssueKeys(
  text: string,
  keyPrefix: string,
  openIssue: (key: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let idx = 0
  ISSUE_KEY_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ISSUE_KEY_RE.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const key = match[1]
    nodes.push(
      <button
        key={`${keyPrefix}-key-${idx}`}
        type="button"
        className="text-indigo-400 hover:underline light:text-indigo-600"
        onClick={() => openIssue(key)}
      >
        {key}
      </button>
    )
    idx += 1
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

/** Parser inline: negrito (**texto**) e, dentro de cada segmento, keys de issue viram botões. */
function renderInline(
  text: string,
  keyPrefix: string,
  openIssue: (key: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let idx = 0
  BOLD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BOLD_RE.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(
        ...linkifyIssueKeys(text.slice(lastIndex, match.index), `${keyPrefix}-t${idx}`, openIssue)
      )
    }
    nodes.push(
      <strong key={`${keyPrefix}-b${idx}`} className="font-semibold text-zinc-100">
        {linkifyIssueKeys(match[1], `${keyPrefix}-b${idx}-in`, openIssue)}
      </strong>
    )
    idx += 1
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    nodes.push(...linkifyIssueKeys(text.slice(lastIndex), `${keyPrefix}-t${idx}`, openIssue))
  }
  return nodes
}

type Block =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; lines: string[] }

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraph })
      paragraph = []
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') {
      flushParagraph()
      continue
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      flushParagraph()
      blocks.push({ type: 'heading', text: line.replace(/^#{2,3}\s+/, '') })
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph()
      const content = line.slice(2)
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'list') {
        last.items.push(content)
      } else {
        blocks.push({ type: 'list', items: [content] })
      }
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

/** Markdown leve sem lib externa: headings, listas, negrito e keys de issue clicáveis. */
export function MarkdownLite({ text }: { text: string }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const blocks = parseBlocks(text)

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <h4 key={i} className="text-sm font-semibold text-zinc-200">
              {renderInline(block.text, `h${i}`, openIssue)}
            </h4>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm text-zinc-300">
                  {renderInline(item, `l${i}-${j}`, openIssue)}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="text-sm whitespace-pre-wrap text-zinc-300">
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line, `p${i}-${j}`, openIssue)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
