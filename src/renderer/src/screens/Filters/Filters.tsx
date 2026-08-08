import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Play, Plus, Save, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { Badge, Button, Card, ScreenHeader, Spinner } from '../../components/ui'
import { PairTabs } from '../../components/PairTabs'
import { IssueRow } from '../../components/IssueRow'
import { t } from '../../strings/ptBR'
import type { Issue } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'

/**
 * Faixa de abas do par "Filtros · Timeline" (item único na sidebar, handoff Tela C).
 * Navegação de verdade — não estado local: a aba ativa é a rota atual.
 */
type SavedFilter = IpcResponse<'filters:list'>['filters'][number]

/** Rótulo dos campos do editor (10px caixa alta) — padrão do design system. */
const fieldLabel = 'block text-[10px] font-bold tracking-[.06em] text-zinc-600 uppercase'

/**
 * Relógio do cronômetro de execução. Fica fora do componente porque a regra de
 * pureza do react-hooks proíbe chamar `performance.now()` dentro dele.
 */
function nowMs(): number {
  return performance.now()
}

/**
 * Estado sem conteúdo não vira cartão (regra do handoff): é uma linha de ~26px.
 * Vale para "nenhum filtro salvo", "execute o JQL" e "nenhum resultado".
 */
function HintLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-1.5 text-[12.5px] text-zinc-500 shadow-card">
      {children}
    </div>
  )
}

export default function Filters(): React.JSX.Element {
  const queryClient = useQueryClient()

  const { data: filtersData, isLoading: filtersLoading } = useQuery({
    queryKey: ['filters'],
    queryFn: () => invoke('filters:list', {})
  })
  const filters = filtersData?.filters ?? []

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [jql, setJql] = useState('')

  const [runBusy, setRunBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [results, setResults] = useState<Issue[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  /** tempo da última execução bem-sucedida, medido no cliente (não vem do IPC) */
  const [runMs, setRunMs] = useState<number | null>(null)

  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const runJql = async (queryJql: string): Promise<void> => {
    const trimmed = queryJql.trim()
    if (!trimmed) return
    setRunBusy(true)
    setRunError(null)
    const startedAt = nowMs()
    try {
      const res = await invoke('filters:run', { jql: trimmed })
      setResults(res.issues)
      setTruncated(res.truncated)
      setRunMs(Math.round(nowMs() - startedAt))
    } catch (err) {
      setResults(null)
      setTruncated(false)
      setRunMs(null)
      setRunError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setRunBusy(false)
    }
  }

  const newFilter = (): void => {
    setEditingId(null)
    setName('')
    setJql('')
    setResults(null)
    setRunError(null)
    setSaveError(null)
    setRunMs(null)
  }

  const loadFilter = (filter: SavedFilter): void => {
    setEditingId(filter.id)
    setName(filter.name)
    setJql(filter.jql)
    setSaveError(null)
    setDeleteConfirmId(null)
    void runJql(filter.jql)
  }

  const save = async (): Promise<void> => {
    const trimmedName = name.trim()
    const trimmedJql = jql.trim()
    if (!trimmedName || !trimmedJql) return
    setSaveBusy(true)
    setSaveError(null)
    try {
      const res = await invoke('filters:save', {
        id: editingId ?? undefined,
        name: trimmedName,
        jql: trimmedJql
      })
      setEditingId(res.id)
      void queryClient.invalidateQueries({ queryKey: ['filters'] })
    } catch (err) {
      setSaveError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setSaveBusy(false)
    }
  }

  const removeFilter = async (id: number): Promise<void> => {
    try {
      await invoke('filters:delete', { id })
      if (editingId === id) newFilter()
      void queryClient.invalidateQueries({ queryKey: ['filters'] })
    } finally {
      setDeleteConfirmId(null)
    }
  }

  const runDisabled = runBusy || !jql.trim()
  const saveDisabled = saveBusy || !name.trim() || !jql.trim()

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.nav.filtersTimeline} flush />
      <PairTabs
        tabs={[
          { to: '/filtros', label: t.nav.filters },
          { to: '/timeline', label: t.nav.timeline }
        ]}
      />
      {/* items-start: quem estica é a coluna, nunca o cartão (senão fica oco) */}
      <div className="flex min-h-0 flex-1 items-start gap-3.5 overflow-y-auto p-[18px_24px]">
        <div className="flex w-[270px] shrink-0 flex-col gap-3">
          {filtersLoading ? (
            <HintLine>
              <Spinner /> {t.common.loading}
            </HintLine>
          ) : filters.length === 0 ? (
            <HintLine>{t.filters.noSavedFilters}</HintLine>
          ) : (
            <Card
              title={
                <span className="flex items-center gap-2.5">
                  {t.filters.savedTitle}
                  <Badge color="zinc">{filters.length}</Badge>
                </span>
              }
              bodyClassName="p-1.5"
            >
              <div className="flex flex-col">
                {filters.map((filter) => {
                  const active = editingId === filter.id
                  return (
                    <div
                      key={filter.id}
                      className={`flex items-center gap-2 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
                        active
                          ? 'bg-indigo-600/12 font-semibold text-indigo-400'
                          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                      }`}
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left"
                        onClick={() => loadFilter(filter)}
                        title={filter.jql}
                      >
                        {filter.name}
                      </button>
                      {/* lápis e lixeira só no filtro ativo — a lista fica limpa */}
                      {active &&
                        (deleteConfirmId === filter.id ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-normal">
                            <span className="text-zinc-500">{t.filters.deleteConfirm}</span>
                            <button
                              className="text-red-400 hover:underline light:text-red-600"
                              onClick={() => void removeFilter(filter.id)}
                            >
                              {t.filters.yes}
                            </button>
                            <button
                              className="text-zinc-500 hover:underline"
                              onClick={() => setDeleteConfirmId(null)}
                            >
                              {t.filters.no}
                            </button>
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <button
                              className="text-indigo-400 transition-colors hover:text-indigo-300 light:hover:text-indigo-700"
                              title={t.filters.edit}
                              onClick={() => loadFilter(filter)}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              className="text-indigo-400 transition-colors hover:text-red-400 light:hover:text-red-600"
                              title={t.filters.delete}
                              onClick={() => setDeleteConfirmId(filter.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </span>
                        ))}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
          {/* fora do cartão, largura total: é ação da coluna, não item da lista */}
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-[12.5px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            onClick={newFilter}
          >
            <Plus size={13} />
            Novo filtro
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Card bodyClassName="flex flex-col gap-3 p-4">
            <div>
              <label className={fieldLabel} htmlFor="filtro-nome">
                {t.filters.nameLabel}
              </label>
              <input
                id="filtro-nome"
                className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
                placeholder={t.filters.namePlaceholder}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="filtro-jql">
                {t.filters.jqlLabel}
              </label>
              <textarea
                id="filtro-jql"
                className="mt-1.5 h-[84px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-zinc-300 outline-none focus:border-indigo-500"
                placeholder={t.filters.jqlPlaceholder}
                value={jql}
                onChange={(e) => setJql(e.target.value)}
              />
              <p className="mt-1.5 text-[11.5px] leading-snug text-zinc-500">
                {t.filters.jqlExamplesHint}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <Button disabled={runDisabled} onClick={() => void runJql(jql)}>
                {runBusy ? <Spinner /> : <Play size={12} />}
                {runBusy ? t.filters.running : t.filters.run}
              </Button>
              <Button variant="secondary" disabled={saveDisabled} onClick={() => void save()}>
                {saveBusy ? <Spinner /> : <Save size={12} />}
                {saveBusy ? t.filters.saving : t.filters.save}
              </Button>
              {runMs !== null && !runBusy && (
                <span className="ml-auto text-[11.5px] text-zinc-500">rodou em {runMs} ms</span>
              )}
            </div>
            {saveError && (
              <p className="text-[12.5px] text-red-400 light:text-red-600">{saveError}</p>
            )}
          </Card>

          {runError ? (
            <div className="rounded-lg border border-red-900/55 bg-red-950/28 px-3.5 py-2 text-[12.5px] text-red-400 shadow-card light:border-red-300 light:bg-red-50 light:text-red-600">
              {runError}
            </div>
          ) : results === null ? (
            <HintLine>{t.filters.runToSeeResults}</HintLine>
          ) : results.length === 0 ? (
            <HintLine>{t.filters.empty}</HintLine>
          ) : (
            <Card
              title={
                <span className="flex items-center gap-2.5">
                  Resultados
                  <Badge color="brand">{results.length}</Badge>
                </span>
              }
              bodyClassName="px-4 py-1"
            >
              <div className="divide-y divide-zinc-800/60">
                {results.map((issue) => (
                  <IssueRow key={issue.key} issue={issue} />
                ))}
              </div>
              {truncated && (
                <p className="border-t border-zinc-800/60 pt-2 pb-1 text-[11.5px] text-amber-400 light:text-amber-600">
                  {t.filters.truncatedHint}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
