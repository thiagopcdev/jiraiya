import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Check, Copy, Download, Save, Sparkles, Trash2 } from 'lucide-react'
import type { Period } from '@shared/periods'
import type { SummaryTemplate } from '@shared/domain'
import { invoke } from '../../api/client'
import { Button, Card, EmptyState, Spinner } from '../../components/ui'
import { t } from '../../strings/ptBR'

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

export default function Summaries(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [periodKey, setPeriodKey] = useState('7d')
  const [template, setTemplate] = useState<SummaryTemplate>('standup')
  const [useClaude, setUseClaude] = useState(true)
  const [content, setContent] = useState('')
  const [generatedBy, setGeneratedBy] = useState<'template' | 'claude' | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [claudeFellBack, setClaudeFellBack] = useState(false)

  const period = periodOptions.find((p) => p.key === periodKey)!.period

  const { data: claudeInfo } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })
  const { data: history } = useQuery({
    queryKey: ['summaries'],
    queryFn: () => invoke('summaries:list', {})
  })

  const generate = async (): Promise<void> => {
    setBusy(true)
    setClaudeFellBack(false)
    try {
      const wantClaude = useClaude && (claudeInfo?.available ?? false)
      const res = await invoke('summaries:generate', { period, template, useClaude: wantClaude })
      setContent(res.markdown)
      setGeneratedBy(res.generatedBy)
      if (wantClaude && res.generatedBy === 'template') setClaudeFellBack(true)
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
    if (!generatedBy) return
    await invoke('summaries:save', { period, template, contentMd: content, generatedBy })
    void queryClient.invalidateQueries({ queryKey: ['summaries'] })
  }

  const remove = async (id: number): Promise<void> => {
    await invoke('summaries:delete', { id })
    void queryClient.invalidateQueries({ queryKey: ['summaries'] })
  }

  return (
    <div className="space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">Resumos</h2>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
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
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Formato</span>
            <select
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
              value={template}
              onChange={(e) => setTemplate(e.target.value as SummaryTemplate)}
            >
              {templateOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-2 pb-1.5 text-sm ${
              claudeInfo?.available ? 'cursor-pointer text-zinc-300' : 'text-zinc-600'
            }`}
            title={
              claudeInfo?.available
                ? 'Reescreve o resumo com o Claude (CLI local)'
                : 'CLI do Claude não encontrado nesta máquina'
            }
          >
            <input
              type="checkbox"
              className="accent-indigo-600"
              disabled={!claudeInfo?.available}
              checked={useClaude && (claudeInfo?.available ?? false)}
              onChange={(e) => setUseClaude(e.target.checked)}
            />
            <Sparkles size={14} className="text-indigo-400" />
            Aprimorar com Claude
          </label>
          <Button className="ml-auto" disabled={busy} onClick={() => void generate()}>
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
              {generatedBy === 'claude' && (
                <span className="flex items-center gap-1 text-xs font-normal text-indigo-400">
                  <Sparkles size={12} /> gerado com Claude
                </span>
              )}
              {claudeFellBack && (
                <span className="text-xs font-normal text-amber-400">
                  Gerado por template — Claude indisponível
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
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t.common.copied : t.common.copy}
            </Button>
            <Button variant="secondary" onClick={() => void exportFile()}>
              <Download size={14} />
              {t.common.export}
            </Button>
            <Button variant="secondary" onClick={() => void save()}>
              <Save size={14} />
              Salvar no histórico
            </Button>
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
                  className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
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
    </div>
  )
}
