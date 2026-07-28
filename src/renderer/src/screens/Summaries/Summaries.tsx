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
import { Check, Copy, Download, Save, Sparkles, Trash2 } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { AiGeneratedBy, SummaryTemplate } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { invoke } from '../../api/client'
import { useAiStatus, useSprintList } from '../../api/hooks'
import { Button, Card, EmptyState, Spinner } from '../../components/ui'
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

  const period = periodOptions.find((p) => p.key === periodKey)!.period
  const isSprintRetro = template === 'sprint_retro'

  const { data: aiStatus } = useAiStatus()
  const { data: history } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => invoke('summaries:list', {})
  })
  const { data: sprintList } = useSprintList()
  const sprints = useMemo(() => sprintList?.sprints ?? [], [sprintList])

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
    const content = [header, ...lines].join('\n')
    const name = `worklogs-${worklogRangeUsed.start}-a-${worklogRangeUsed.end}.csv`
    await invoke('export:file', { content, suggestedName: name })
  }

  return (
    <div className="space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">Resumos</h2>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {isSprintRetro ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Sprint</span>
              <select
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
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
            </label>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Período</span>
              <select
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {periodOptions.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Formato</span>
            <select
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
              value={template}
              onChange={(e) => setTemplate(e.target.value as SummaryKind)}
            >
              {summaryKindOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-2 pb-1.5 text-sm ${
              aiStatus?.active ? 'cursor-pointer text-zinc-300' : 'text-zinc-600'
            }`}
            title={
              aiStatus?.active
                ? `Reescreve o resumo com ${aiStatus.active.label}`
                : 'Nenhum provider de IA disponível — configure em Ajustes'
            }
          >
            <input
              type="checkbox"
              className="accent-indigo-600"
              disabled={!aiStatus?.active}
              checked={useAi && Boolean(aiStatus?.active)}
              onChange={(e) => setUseAi(e.target.checked)}
            />
            <Sparkles size={14} className="text-indigo-400 light:text-indigo-600" />
            Aprimorar com {aiStatus?.active?.label ?? 'IA'}
          </label>
          <Button
            className="ml-auto"
            disabled={busy || (isSprintRetro && effectiveSprintId == null)}
            onClick={() => void generate()}
          >
            {busy && <Spinner />}
            {busy ? 'Gerando…' : 'Gerar resumo'}
          </Button>
        </div>
      </Card>

      {content && (
        <Card
          title={
            <span className="flex items-center gap-2">
              Prévia (editável)
              {generatedBy && generatedBy !== 'template' && (
                <span className="flex items-center gap-1 text-xs font-normal text-indigo-400 light:text-indigo-600">
                  <Sparkles size={12} /> gerado com {generatedByLabel(generatedBy, aiStatus)}
                </span>
              )}
              {aiFellBack && (
                <span className="text-xs font-normal text-amber-400 light:text-amber-600">
                  Gerado por template — {aiStatus?.active?.label ?? 'IA'} indisponível
                </span>
              )}
            </span>
          }
        >
          <textarea
            className="h-72 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm text-zinc-200 outline-none focus:border-indigo-600"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <CitedIssueChips content={content} />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t.common.copied : t.common.copy}
            </Button>
            <Button variant="secondary" onClick={() => void exportFile()}>
              <Download size={14} />
              {t.common.export}
            </Button>
            {!isSprintRetro && (
              <Button variant="secondary" onClick={() => void save()}>
                <Save size={14} />
                Salvar no histórico
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card title="Histórico">
        {!history || history.summaries.length === 0 ? (
          <EmptyState message="Nenhum resumo salvo ainda." />
        ) : (
          <div className="divide-y divide-zinc-800">
            {history.summaries.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setContent(s.contentMd)
                    setGeneratedBy(s.generatedBy)
                  }}
                  title="Carregar no editor"
                >
                  <div className="text-sm text-zinc-200">
                    {templateOptions.find((o) => o.key === s.template)?.label ?? s.template}
                    <span className="ml-2 text-xs text-zinc-500">
                      {format(new Date(s.createdAt), 'dd/MM/yyyy HH:mm')}
                    </span>
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {s.contentMd.replace(/[#*_\n]/g, ' ').slice(0, 120)}
                  </div>
                </button>
                <button
                  className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 light:hover:text-red-600"
                  onClick={() => void remove(s.id)}
                  title={t.common.delete}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Worklogs do período">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Período</span>
            <select
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
              value={worklogPeriodKey}
              onChange={(e) => setWorklogPeriodKey(e.target.value as WorklogPeriodKey)}
            >
              {worklogPeriodOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button className="ml-auto" disabled={worklogBusy} onClick={() => void generateWorklog()}>
            {worklogBusy && <Spinner />}
            {worklogBusy ? 'Gerando…' : 'Gerar'}
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                      <th className="py-1.5 pr-3 font-medium">Data</th>
                      <th className="py-1.5 pr-3 font-medium">Card</th>
                      <th className="py-1.5 pr-3 font-medium">Tempo</th>
                      <th className="py-1.5 font-medium">Comentário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {worklogResult.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-400">
                          {format(new Date(r.date), 'dd/MM')}
                        </td>
                        <td className="py-1.5 pr-3">
                          <button
                            className="font-mono text-xs text-indigo-400 hover:underline light:text-indigo-600"
                            onClick={() => openIssue(r.key)}
                          >
                            {r.key}
                          </button>
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-300">
                          {r.timeSpent}
                        </td>
                        <td className="py-1.5 text-zinc-400">{truncate(r.comment ?? '', 80)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-800 font-semibold text-zinc-200">
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
  )
}

/** Keys de cards citadas no resumo, como chips que abrem a gaveta (o texto acima é um textarea — não dá para linkificar dentro dele). */
function CitedIssueChips({ content }: { content: string }): React.JSX.Element | null {
  const { openIssue } = useIssueDetail()
  const keys = useMemo(() => {
    const found = content.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? []
    return [...new Set(found)]
  }, [content])
  if (keys.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-zinc-500">Cards citados:</span>
      {keys.map((key) => (
        <button
          key={key}
          className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-indigo-400 hover:bg-zinc-700 hover:text-indigo-300 light:text-indigo-600 light:hover:text-indigo-700"
          onClick={() => openIssue(key)}
        >
          {key}
        </button>
      ))}
    </div>
  )
}
