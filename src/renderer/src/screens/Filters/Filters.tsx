import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { Button, Card, Spinner } from '../../components/ui'
import { IssueRow } from '../../components/IssueRow'
import { t } from '../../strings/ptBR'
import type { Issue } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'

type SavedFilter = IpcResponse<'filters:list'>['filters'][number]

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

  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const runJql = async (queryJql: string): Promise<void> => {
    const trimmed = queryJql.trim()
    if (!trimmed) return
    setRunBusy(true)
    setRunError(null)
    try {
      const res = await invoke('filters:run', { jql: trimmed })
      setResults(res.issues)
      setTruncated(res.truncated)
    } catch (err) {
      setResults(null)
      setTruncated(false)
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
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">{t.filters.savedTitle}</h3>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title={t.filters.newFilter}
            onClick={newFilter}
          >
            <Plus size={14} />
          </button>
        </div>
        {filtersLoading ? (
          <div className="flex items-center gap-2 px-1 text-xs text-zinc-500">
            <Spinner /> {t.common.loading}
          </div>
        ) : filters.length === 0 ? (
          <p className="px-1 text-xs text-zinc-600">{t.filters.noSavedFilters}</p>
        ) : (
          <div className="space-y-0.5">
            {filters.map((filter) => (
              <div
                key={filter.id}
                className={`group flex items-center gap-1 rounded-md px-1.5 py-1 ${
                  editingId === filter.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm text-zinc-200"
                  onClick={() => loadFilter(filter)}
                  title={filter.jql}
                >
                  {filter.name}
                </button>
                {deleteConfirmId === filter.id ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    <span className="text-zinc-500">{t.filters.deleteConfirm}</span>
                    <button
                      className="text-red-400 hover:underline"
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
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                      title={t.filters.edit}
                      onClick={() => loadFilter(filter)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="rounded p-1 text-zinc-500 hover:text-red-400"
                      title={t.filters.delete}
                      onClick={() => setDeleteConfirmId(filter.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
        <h2 className="text-xl font-semibold text-zinc-100">{t.filters.title}</h2>

        <Card>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">
                {t.filters.nameLabel}
              </span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500"
                placeholder={t.filters.namePlaceholder}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">
                {t.filters.jqlLabel}
              </span>
              <textarea
                className="h-24 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-500"
                value={jql}
                onChange={(e) => setJql(e.target.value)}
              />
              <span className="mt-1 block text-xs text-zinc-500">{t.filters.jqlExamplesHint}</span>
            </label>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={runDisabled} onClick={() => void runJql(jql)}>
                {runBusy && <Spinner />}
                {runBusy ? t.filters.running : t.filters.run}
              </Button>
              <Button disabled={saveDisabled} onClick={() => void save()}>
                {saveBusy && <Spinner />}
                {saveBusy ? t.filters.saving : t.filters.save}
              </Button>
            </div>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          </div>
        </Card>

        <Card>
          {runError ? (
            <p className="text-sm text-red-400">{runError}</p>
          ) : results === null ? (
            <p className="text-sm text-zinc-500">{t.filters.runToSeeResults}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-zinc-500">{t.filters.empty}</p>
          ) : (
            <div className="space-y-1">
              <p className="mb-2 text-xs text-zinc-500">{t.filters.resultsCount(results.length)}</p>
              {results.map((issue) => (
                <IssueRow key={issue.key} issue={issue} />
              ))}
              {truncated && (
                <p className="mt-2 text-xs text-amber-400">{t.filters.truncatedHint}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
