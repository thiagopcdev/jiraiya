import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks
} from 'date-fns'
import { ptBR as ptBRLocale } from 'date-fns/locale'
import { Check, Copy, Download, Pencil, Save, Sparkles, Trash2 } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { AiGeneratedBy, SummaryTemplate } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { invoke } from '../../api/client'
import { useAiStatus, useSprintList } from '../../api/hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  SegmentedControl,
  Spinner,
  Toggle
} from '../../components/ui'
import { useIssueDetail } from '../../components/issueDetail'
import { t } from '../../strings/ptBR'

/** União local: 'sprint_retro' é um pseudo-template só desta tela, não faz parte do domínio compartilhado. */
type SummaryKind = SummaryTemplate | 'sprint_retro'

const periodOptions: Array<{ key: string; label: string; period: Period }> = [
  { key: 'yesterday', label: 'Ontem', period: { type: 'yesterday' } },
  { key: 'today', label: 'Hoje', period: { type: 'today' } },
  { key: '7d', label: 'Últimos 7 dias', period: { type: '7d' } },
  { key: '30d', label: 'Últimos 30 dias', period: { type: '30d' } },
  { key: 'sprint', label: 'Sprint atual', period: { type: 'sprint' } }
]

const templateOptions: Array<{ key: SummaryTemplate; label: string }> = [
  { key: 'standup', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'one_on_one', label: '1:1' },
  { key: 'monthly', label: 'Mensal' }
]

const summaryKindOptions: Array<{ key: SummaryKind; label: string }> = [
  ...templateOptions,
  { key: 'sprint_retro', label: 'Retro de sprint' }
]

/**
 * Uma cor por template na pílula do histórico — é o que deixa a coluna
 * escaneável. Sem `accent`: pelo contrato ele é exclusivo do crachá de menções.
 */
const templatePillClass: Record<SummaryTemplate, string> = {
  standup: 'bg-indigo-600/16 text-indigo-400',
  weekly: 'bg-green-600/16 text-green-400 light:text-green-600',
  one_on_one: 'bg-amber-600/16 text-amber-400 light:text-amber-600',
  monthly: 'bg-blue-600/16 text-blue-400 light:text-blue-600'
}

function templateLabel(template: SummaryTemplate): string {
  return templateOptions.find((o) => o.key === template)?.label ?? template
}

type WorklogPeriodKey = 'this_week' | 'last_week' | 'this_month' | 'last_month'

const worklogPeriodOptions: Array<{ key: WorklogPeriodKey; label: string }> = [
  { key: 'this_week', label: 'Esta semana' },
  { key: 'last_week', label: 'Semana passada' },
  { key: 'this_month', label: 'Este mês' },
  { key: 'last_month', label: 'Mês passado' }
]

/** start/end locais YYYY-MM-DD, intervalo fechado; semana começa segunda. */
function worklogRange(key: WorklogPeriodKey): { start: string; end: string } {
  const now = new Date()
  const fmt = (d: Date): string => format(d, 'yyyy-MM-dd')
  switch (key) {
    case 'this_week':
      return {
        start: fmt(startOfWeek(now, { weekStartsOn: 1 })),
        end: fmt(endOfWeek(now, { weekStartsOn: 1 }))
      }
    case 'last_week': {
      const lastWeek = subWeeks(now, 1)
      return {
        start: fmt(startOfWeek(lastWeek, { weekStartsOn: 1 })),
        end: fmt(endOfWeek(lastWeek, { weekStartsOn: 1 }))
      }
    }
    case 'this_month':
      return { start: fmt(startOfMonth(now)), end: fmt(endOfMonth(now)) }
    case 'last_month': {
      const lastMonth = subMonths(now, 1)
      return { start: fmt(startOfMonth(lastMonth)), end: fmt(endOfMonth(lastMonth)) }
    }
  }
}

function formatSecondsHm(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const selectClass =
  'rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200'

/**
 * Label do provider que gerou um resumo salvo: usa o label do status ATUAL se o id do
 * provider ainda bater com algum da lista (renomeou/mudou de detail sem perder o nome
 * amigável); cai para 'IA' quando o provider não existe mais no status corrente
 * (dado antigo persistido, ex.: 'claude' de antes da migração multi-provider).
 */
function generatedByLabel(
  generatedBy: AiGeneratedBy,
  aiStatus: IpcResponse<'ai:status'> | undefined
): string {
  const found = aiStatus?.providers.find((p) => p.id === generatedBy)
  return found?.label ?? 'IA'
}

export default function Summaries(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { openIssue } = useIssueDetail()
  const [periodKey, setPeriodKey] = useState('7d')
  const [template, setTemplate] = useState<SummaryKind>('standup')
  const [sprintJiraId, setSprintJiraId] = useState<number | null>(null)
  const [useAi, setUseAi] = useState(true)
  const [content, setContent] = useState('')
  const [generatedBy, setGeneratedBy] = useState<AiGeneratedBy | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [aiFellBack, setAiFellBack] = useState(false)
  const [editing, setEditing] = useState(false)
  /** o que a FAIXA do resultado descreve — congelado no momento em que o texto entrou na tela */
  const [resultKind, setResultKind] = useState<SummaryKind>('standup')
  const [resultAt, setResultAt] = useState<string | null>(null)

  const period = periodOptions.find((p) => p.key === periodKey)!.period
  const isSprintRetro = template === 'sprint_retro'

  const { data: aiStatus } = useAiStatus()
  const { data: history } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => invoke('summaries:list', {})
  })
  const { data: sprintList } = useSprintList()
  const sprints = useMemo(() => sprintList?.sprints ?? [], [sprintList])
  const saved = history?.summaries ?? []

  // Default: sprint fechada mais recente; senão a ativa.
  const defaultSprintId = useMemo(() => {
    const mostRecentClosed = sprints
      .filter((s) => s.state === 'closed')
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0]
    if (mostRecentClosed) return mostRecentClosed.jiraId
    return sprints.find((s) => s.state === 'active')?.jiraId ?? null
  }, [sprints])
  const effectiveSprintId = sprintJiraId ?? defaultSprintId

  const generate = async (): Promise<void> => {
    if (isSprintRetro && effectiveSprintId == null) return
    setBusy(true)
    setAiFellBack(false)
    try {
      const wantAi = useAi && Boolean(aiStatus?.active)
      const res = isSprintRetro
        ? await invoke('summaries:sprintRetro', {
            sprintJiraId: effectiveSprintId!,
            useClaude: wantAi
          })
        : await invoke('summaries:generate', { period, template, useClaude: wantAi })
      setContent(res.markdown)
      setGeneratedBy(res.generatedBy)
      setResultKind(template)
      setResultAt(new Date().toISOString())
      setEditing(false)
      if (wantAi && res.generatedBy === 'template') setAiFellBack(true)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    await invoke('export:clipboard', { text: content })
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const exportFile = async (): Promise<void> => {
    const name = `resumo-${template}-${format(new Date(), 'yyyy-MM-dd')}.md`
    await invoke('export:file', { content, suggestedName: name })
  }

  const save = async (): Promise<void> => {
    // Retro de sprint não tem período nem entra no enum de templates salvos no histórico.
    if (!generatedBy || isSprintRetro) return
    await invoke('summaries:save', { period, template, contentMd: content, generatedBy })
    void queryClient.invalidateQueries({ queryKey: ['summaries'] })
  }

  const remove = async (id: number): Promise<void> => {
    await invoke('summaries:delete', { id })
    void queryClient.invalidateQueries({ queryKey: ['summaries'] })
  }

  const [worklogPeriodKey, setWorklogPeriodKey] = useState<WorklogPeriodKey>('this_week')
  const [worklogBusy, setWorklogBusy] = useState(false)
  const [worklogResult, setWorklogResult] = useState<IpcResponse<'worklog:export'> | null>(null)
  const [worklogRangeUsed, setWorklogRangeUsed] = useState<{ start: string; end: string } | null>(
    null
  )
  const [worklogCopied, setWorklogCopied] = useState(false)

  const generateWorklog = async (): Promise<void> => {
    setWorklogBusy(true)
    try {
      const range = worklogRange(worklogPeriodKey)
      const res = await invoke('worklog:export', range)
      setWorklogResult(res)
      setWorklogRangeUsed(range)
    } finally {
      setWorklogBusy(false)
    }
  }

  const copyWorklogMarkdown = async (): Promise<void> => {
    if (!worklogResult) return
    const header = '| Data | Card | Tempo | Comentário |\n| --- | --- | --- | --- |'
    const rows = worklogResult.rows
      .map(
        (r) =>
          `| ${format(new Date(r.date), 'dd/MM')} | ${r.key} | ${r.timeSpent} | ${(r.comment ?? '')
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' ')
            .slice(0, 80)} |`
      )
      .join('\n')
    const total = `| **Total** | | **${formatSecondsHm(worklogResult.totalSeconds)}** | |`
    await invoke('export:clipboard', { text: `${header}\n${rows}\n${total}` })
    setWorklogCopied(true)
    setTimeout(() => setWorklogCopied(false), 1500)
  }

  const exportWorklogCsv = async (): Promise<void> => {
    if (!worklogResult || !worklogRangeUsed) return
    const escapeCsv = (v: string): string => `"${v.replace(/"/g, '""')}"`
    const header = 'date,key,summary,timeSpent,seconds,comment'
    const lines = worklogResult.rows.map((r) =>
      [
        escapeCsv(r.date),
        escapeCsv(r.key),
        escapeCsv(r.summary),
        escapeCsv(r.timeSpent),
        String(r.seconds),
        escapeCsv(r.comment ?? '')
      ].join(',')
    )
    const csv = [header, ...lines].join('\n')
    const name = `worklogs-${worklogRangeUsed.start}-a-${worklogRangeUsed.end}.csv`
    await invoke('export:file', { content: csv, suggestedName: name })
  }

  const resultTitle = [
    summaryKindOptions.find((o) => o.key === resultKind)?.label ?? resultKind,
    resultAt ? format(new Date(resultAt), "d 'de' MMMM", { locale: ptBRLocale }) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Resumos"
        context={`Daily, weekly, 1:1, mensal e retro de sprint · ${saved.length} salvo${
          saved.length === 1 ? '' : 's'
        }`}
      />

      <div className="flex-1 overflow-y-auto px-6 py-[18px]">
        <div className="flex items-start gap-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <Card bodyClassName="flex flex-wrap items-center gap-2.5 p-3">
              <SegmentedControl
                aria-label="Formato do resumo"
                options={summaryKindOptions.map((o) => ({ value: o.key, label: o.label }))}
                value={template}
                onChange={(next) => setTemplate(next)}
              />

              {isSprintRetro ? (
                <select
                  aria-label="Sprint"
                  className={selectClass}
                  value={effectiveSprintId ?? ''}
                  onChange={(e) => setSprintJiraId(Number(e.target.value))}
                >
                  {sprints.length === 0 && <option value="">Nenhuma sprint encontrada</option>}
                  {sprints.map((s) => (
                    <option key={s.jiraId} value={s.jiraId}>
                      {(s.name ?? `Sprint ${s.jiraId}`) + (s.state === 'active' ? ' (ativa)' : '')}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label="Período"
                  className={selectClass}
                  value={periodKey}
                  onChange={(e) => setPeriodKey(e.target.value)}
                >
                  {periodOptions.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}

              <span
                className="ml-auto flex items-center gap-2 text-[12.5px] text-zinc-400"
                title={
                  aiStatus?.active
                    ? `Reescreve o resumo com ${aiStatus.active.label}`
                    : 'Nenhum provider de IA disponível — configure em Ajustes'
                }
              >
                <span id="summaries-use-ai">usar IA</span>
                <Toggle
                  aria-labelledby="summaries-use-ai"
                  disabled={!aiStatus?.active}
                  checked={useAi && Boolean(aiStatus?.active)}
                  onChange={setUseAi}
                />
              </span>

              <Button
                disabled={busy || (isSprintRetro && effectiveSprintId == null)}
                onClick={() => void generate()}
              >
                {busy ? <Spinner /> : <Sparkles size={13} />}
                {busy ? 'Gerando…' : 'Gerar'}
              </Button>
            </Card>

            {content && (
              <Card
                title={
                  <span className="flex items-center gap-2.5">
                    {resultTitle}
                    {generatedBy && generatedBy !== 'template' && (
                      <span className="flex items-center gap-1.5 rounded-full bg-indigo-600/16 px-2 py-0.5 text-[10.5px] font-bold text-indigo-400">
                        <Sparkles size={10} />
                        {generatedByLabel(generatedBy, aiStatus)}
                      </span>
                    )}
                    {aiFellBack && (
                      <span className="text-[11.5px] font-normal text-amber-400 light:text-amber-600">
                        Gerado por template — {aiStatus?.active?.label ?? 'IA'} indisponível
                      </span>
                    )}
                  </span>
                }
                actions={
                  <>
                    <Button variant="ghost" onClick={() => setEditing((v) => !v)}>
                      <Pencil size={12} />
                      {editing ? 'Pronto' : 'Editar'}
                    </Button>
                    <Button variant="secondary" onClick={() => void copy()}>
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? t.common.copied : t.common.copy}
                    </Button>
                    {!isSprintRetro && (
                      <Button variant="secondary" onClick={() => void save()}>
                        <Save size={12} />
                        Salvar
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => void exportFile()}>
                      <Download size={12} />
                      .md
                    </Button>
                  </>
                }
                bodyClassName="px-[18px] py-4"
              >
                {editing ? (
                  <textarea
                    aria-label="Conteúdo do resumo"
                    className="h-72 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[12.5px] text-zinc-200 outline-none focus:border-indigo-600"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                ) : (
                  <SummaryBody text={content} onOpenIssue={openIssue} />
                )}
              </Card>
            )}

            <Card title="Worklogs do período">
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  aria-label="Período dos worklogs"
                  className={selectClass}
                  value={worklogPeriodKey}
                  onChange={(e) => setWorklogPeriodKey(e.target.value as WorklogPeriodKey)}
                >
                  {worklogPeriodOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  className="ml-auto"
                  disabled={worklogBusy}
                  onClick={() => void generateWorklog()}
                >
                  {worklogBusy && <Spinner />}
                  {worklogBusy ? 'Gerando…' : 'Gerar tabela'}
                </Button>
              </div>

              {worklogResult &&
                (worklogResult.rows.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState message="Nenhum worklog seu no período." />
                  </div>
                ) : (
                  <>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b border-zinc-800 text-left text-[11px] font-bold tracking-[.04em] text-zinc-600 uppercase">
                            <th className="py-1.5 pr-3 font-bold">Data</th>
                            <th className="py-1.5 pr-3 font-bold">Card</th>
                            <th className="py-1.5 pr-3 font-bold">Tempo</th>
                            <th className="py-1.5 font-bold">Comentário</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {worklogResult.rows.map((r, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-400">
                                {format(new Date(r.date), 'dd/MM')}
                              </td>
                              <td className="py-1.5 pr-3">
                                <button
                                  className="font-mono text-[11.5px] text-indigo-400 hover:underline"
                                  onClick={() => openIssue(r.key)}
                                >
                                  {r.key}
                                </button>
                              </td>
                              <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-300">
                                {r.timeSpent}
                              </td>
                              <td className="py-1.5 text-zinc-400">
                                {truncate(r.comment ?? '', 80)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-zinc-800 font-bold text-zinc-50">
                            <td className="py-1.5 pr-3" colSpan={2}>
                              Total
                            </td>
                            <td className="py-1.5 pr-3 whitespace-nowrap">
                              {formatSecondsHm(worklogResult.totalSeconds)}
                            </td>
                            <td className="py-1.5"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" onClick={() => void copyWorklogMarkdown()}>
                        {worklogCopied ? <Check size={14} /> : <Copy size={14} />}
                        {worklogCopied ? t.common.copied : 'Copiar (markdown)'}
                      </Button>
                      <Button variant="secondary" onClick={() => void exportWorklogCsv()}>
                        <Download size={14} />
                        Exportar CSV
                      </Button>
                    </div>
                  </>
                ))}
            </Card>
          </div>

          <div className="w-[300px] shrink-0">
            {/* histórico vazio é linha de ~26px, não cartão com empty state (regra 3) */}
            {saved.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-[12.5px] text-zinc-400">
                <span className="font-semibold text-zinc-200">Salvos 0</span> — resumos que você
                salvar aparecem aqui
              </div>
            ) : (
              <Card
                title="Salvos"
                actions={<Badge color="zinc">{saved.length}</Badge>}
                bodyClassName="px-4 pt-0.5 pb-2.5"
              >
                <div className="flex flex-col">
                  {saved.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2.5 border-b border-zinc-800/60 py-2.5 last:border-0"
                    >
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${templatePillClass[s.template]}`}
                      >
                        {templateLabel(s.template)}
                      </span>
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setContent(s.contentMd)
                          setGeneratedBy(s.generatedBy)
                          setResultKind(s.template)
                          setResultAt(s.createdAt)
                          setAiFellBack(false)
                          setEditing(false)
                        }}
                        title="Carregar no editor"
                      >
                        <span className="block truncate text-[12.5px] text-zinc-200">
                          {format(new Date(s.createdAt), "d 'de' MMMM", { locale: ptBRLocale })}
                        </span>
                        <span className="mt-px block truncate text-[11px] text-zinc-500">
                          {s.generatedBy === 'template'
                            ? 'sem IA'
                            : generatedByLabel(s.generatedBy, aiStatus)}
                        </span>
                      </button>
                      <button
                        className="shrink-0 rounded p-1 text-zinc-600 hover:text-zinc-300"
                        onClick={() => void invoke('export:clipboard', { text: s.contentMd })}
                        title="Copiar resumo salvo"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="shrink-0 rounded p-1 text-zinc-600 hover:text-red-400 light:hover:text-red-600"
                        onClick={() => void remove(s.id)}
                        title={t.common.delete}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g
const BOLD_RE = /\*\*(.+?)\*\*/g

type SummaryBlock =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; lines: string[] }

/** Markdown do resumo em blocos — só o que os templates da app emitem (título, lista, parágrafo). */
function parseSummary(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  let paragraph: string[] = []

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraph })
      paragraph = []
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') {
      flush()
      continue
    }
    if (/^#{1,4}\s+/.test(line)) {
      flush()
      blocks.push({ type: 'heading', text: line.replace(/^#{1,4}\s+/, '') })
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flush()
      const item = line.slice(2)
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'list') last.items.push(item)
      else blocks.push({ type: 'list', items: [item] })
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}

/** Keys de card viram botões mono de marca que abrem a gaveta. */
function linkifyKeys(
  text: string,
  prefix: string,
  onOpenIssue: (key: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let i = 0
  ISSUE_KEY_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ISSUE_KEY_RE.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const key = match[0]
    nodes.push(
      <button
        key={`${prefix}-k${i}`}
        type="button"
        className="font-mono text-[11.5px] text-indigo-400 hover:underline"
        onClick={() => onOpenIssue(key)}
      >
        {key}
      </button>
    )
    i += 1
    last = match.index + key.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderInline(
  text: string,
  prefix: string,
  onOpenIssue: (key: string) => void
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let i = 0
  BOLD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BOLD_RE.exec(text))) {
    if (match.index > last) {
      nodes.push(...linkifyKeys(text.slice(last, match.index), `${prefix}-t${i}`, onOpenIssue))
    }
    nodes.push(
      <strong key={`${prefix}-b${i}`} className="font-semibold text-zinc-50">
        {linkifyKeys(match[1], `${prefix}-b${i}-in`, onOpenIssue)}
      </strong>
    )
    i += 1
    last = match.index + match[0].length
  }
  if (last < text.length) {
    nodes.push(...linkifyKeys(text.slice(last), `${prefix}-t${i}`, onOpenIssue))
  }
  return nodes
}

/** Corpo do resumo na tipografia do DS: coluna de 70ch, seção em negrito, keys em mono de marca. */
function SummaryBody({
  text,
  onOpenIssue
}: {
  text: string
  onOpenIssue: (key: string) => void
}): React.JSX.Element {
  const blocks = parseSummary(text)

  return (
    <div className="flex max-w-[70ch] flex-col gap-3 text-[13px] leading-[1.65] text-zinc-300">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <h4 key={i} className="-mb-2 text-[13.5px] font-bold text-zinc-50">
              {renderInline(block.text, `h${i}`, onOpenIssue)}
            </h4>
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, `l${i}-${j}`, onOpenIssue)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line, `p${i}-${j}`, onOpenIssue)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
