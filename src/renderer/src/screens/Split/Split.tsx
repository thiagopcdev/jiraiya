import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, PanelRight, Sparkles, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { useIssueTypes, useIssues } from '../../api/hooks'
import { Badge, Button, Card, Input, Spinner } from '../../components/ui'
import { MarkdownToolbar } from '../../components/MarkdownToolbar'
import { statusColor } from '../../components/statusColor'
import { t } from '../../strings/ptBR'
import type { Issue } from '@shared/domain'
import { useIssueDetail } from '../../components/issueDetail'

interface EditableItem {
  id: string
  title: string
  description: string
}

const DESCRIPTION_PREVIEW_LIMIT = 600

function truncateSummary(summary: string, max = 60): string {
  return summary.length > max ? `${summary.slice(0, max)}…` : summary
}

function SplitItemCard({
  item,
  index,
  onChange,
  onRemove
}: {
  item: EditableItem
  index: number
  onChange: (patch: Partial<Pick<EditableItem, 'title' | 'description'>>) => void
  onRemove: () => void
}): React.JSX.Element {
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)

  return (
    <div className="space-y-2 rounded-md border border-zinc-800 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          <Input
            label={`${t.split.itemTitleLabel} ${index + 1}`}
            value={item.title}
            maxLength={255}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-300">
              {t.split.itemDescriptionLabel}
            </span>
            <MarkdownToolbar
              textareaRef={descriptionRef}
              value={item.description}
              onChange={(next) => onChange({ description: next })}
            />
            <textarea
              ref={descriptionRef}
              className="h-40 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-500"
              value={item.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </label>
        </div>
        <Button variant="ghost" aria-label={t.split.removeItem} onClick={onRemove}>
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  )
}

export default function Split(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { openIssue } = useIssueDetail()

  // Card escolhido
  const { data: myIssuesData, isLoading: myIssuesLoading } = useIssues({ type: 'today' }, 'mine')
  const myIssues = myIssuesData?.issues ?? []

  const [manualKey, setManualKey] = useState('')
  const [getBusy, setGetBusy] = useState(false)
  const [getError, setGetError] = useState<string | null>(null)
  const [parent, setParent] = useState<Issue | null>(null)

  // Rascunho da divisão
  const [items, setItems] = useState<EditableItem[]>([])
  const [rationale, setRationale] = useState('')
  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  // Estrutura de criação
  const [modeChoice, setModeChoice] = useState<'subtask' | 'sibling'>('subtask')
  const [issueTypeIdChoice, setIssueTypeIdChoice] = useState<string | null>(null)
  const [assignToMe, setAssignToMe] = useState(true)

  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdKeys, setCreatedKeys] = useState<string[] | null>(null)
  const [commentPosted, setCommentPosted] = useState(true)

  const { data: claudeInfo } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })

  const { data: issueTypesData } = useIssueTypes(parent?.projectKey ?? null, true)
  const allIssueTypes = issueTypesData?.issueTypes ?? []
  const subtaskTypes = allIssueTypes.filter((it) => it.subtask)
  const siblingTypes = allIssueTypes.filter((it) => !it.subtask)

  const effectiveMode: 'subtask' | 'sibling' = subtaskTypes.length === 0 ? 'sibling' : modeChoice
  const typeOptions = effectiveMode === 'subtask' ? subtaskTypes : siblingTypes
  const defaultTypeId =
    effectiveMode === 'sibling'
      ? (typeOptions.find((it) => it.name === parent?.issueType)?.id ?? typeOptions[0]?.id ?? null)
      : (typeOptions[0]?.id ?? null)
  const effectiveIssueTypeId = typeOptions.some((it) => it.id === issueTypeIdChoice)
    ? issueTypeIdChoice
    : defaultTypeId

  const resetAll = (): void => {
    setManualKey('')
    setGetError(null)
    setParent(null)
    setItems([])
    setRationale('')
    setAnalyzeError(null)
    setFeedback('')
    setModeChoice('subtask')
    setIssueTypeIdChoice(null)
    setAssignToMe(true)
    setCreateError(null)
    setCreatedKeys(null)
    setCommentPosted(true)
  }

  const selectParent = (issue: Issue): void => {
    setParent(issue)
    setManualKey('')
    setGetError(null)
    setItems([])
    setRationale('')
    setAnalyzeError(null)
    setFeedback('')
    setModeChoice('subtask')
    setIssueTypeIdChoice(null)
  }

  const searchManualKey = async (): Promise<void> => {
    const key = manualKey.trim()
    if (!key) return
    setGetBusy(true)
    setGetError(null)
    try {
      const res = await invoke('issues:get', { key })
      if (!res.issue) {
        setGetError(t.split.notFound)
        return
      }
      selectParent(res.issue)
    } catch (err) {
      setGetError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setGetBusy(false)
    }
  }

  const analyze = async (): Promise<void> => {
    if (!parent) return
    setAnalyzeBusy(true)
    setAnalyzeError(null)
    try {
      const res = await invoke('issues:splitDraft', { parentKey: parent.key })
      setItems(res.items.map((it) => ({ id: crypto.randomUUID(), ...it })))
      setRationale(res.rationale)
    } catch (err) {
      setAnalyzeError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setAnalyzeBusy(false)
    }
  }

  const refine = async (): Promise<void> => {
    if (!parent) return
    setAnalyzeBusy(true)
    setAnalyzeError(null)
    try {
      const res = await invoke('issues:splitDraft', {
        parentKey: parent.key,
        feedback,
        currentItems: items.map(({ title, description }) => ({ title, description }))
      })
      setItems(res.items.map((it) => ({ id: crypto.randomUUID(), ...it })))
      setRationale(res.rationale)
      setFeedback('')
    } catch (err) {
      setAnalyzeError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setAnalyzeBusy(false)
    }
  }

  const updateItem = (
    id: string,
    patch: Partial<Pick<EditableItem, 'title' | 'description'>>
  ): void => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addItem = (): void => {
    setItems((prev) => [...prev, { id: crypto.randomUUID(), title: '', description: '' }])
  }

  const submit = async (): Promise<void> => {
    if (!parent || !effectiveIssueTypeId) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await invoke('issues:split', {
        parentKey: parent.key,
        mode: effectiveMode,
        issueTypeId: effectiveIssueTypeId,
        items: items.map(({ title, description }) => ({ title, description })),
        assignToMe
      })
      setCreatedKeys(res.keys)
      setCommentPosted(res.commentPosted)
      void invoke('sync:run', { full: false })
      void queryClient.invalidateQueries()
    } catch (err) {
      setCreateError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setCreateBusy(false)
    }
  }

  const descriptionPreview = parent?.descriptionText
    ? parent.descriptionText.length > DESCRIPTION_PREVIEW_LIMIT
      ? `${parent.descriptionText.slice(0, DESCRIPTION_PREVIEW_LIMIT)}…`
      : parent.descriptionText
    : null

  const analyzeDisabled = analyzeBusy || !parent || !claudeInfo?.available
  const submitDisabled =
    createBusy ||
    items.length === 0 ||
    items.some((it) => !it.title.trim()) ||
    !effectiveIssueTypeId

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">{t.split.title}</h2>

      {createdKeys ? (
        <Card className="border-green-900 bg-green-950/30 light:border-green-300 light:bg-green-50">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 shrink-0 text-green-400 light:text-green-600"
              size={20}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                {t.split.createdTitle(createdKeys.length, parent?.key ?? '')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {createdKeys.map((key) => (
                  <div key={key} className="flex items-stretch">
                    <Button variant="secondary" onClick={() => openIssue(key)}>
                      <PanelRight size={14} />
                      {key}
                    </Button>
                    <button
                      className="ml-1 shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      onClick={() => void invoke('shell:openIssue', { issueKey: key })}
                      title={`Abrir ${key} no Jira`}
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {!commentPosted && (
                <p className="mt-3 text-sm text-amber-400 light:text-amber-600">
                  {t.split.commentFailedHint}
                </p>
              )}
              <div className="mt-3 flex items-stretch gap-2">
                <Button variant="secondary" onClick={() => parent && openIssue(parent.key)}>
                  <PanelRight size={14} />
                  {t.split.openParentInJira}
                </Button>
                <button
                  className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => parent && void invoke('shell:openIssue', { issueKey: parent.key })}
                  title={parent ? `Abrir ${parent.key} no Jira` : undefined}
                >
                  <ExternalLink size={13} />
                </button>
                <Button variant="ghost" onClick={resetAll}>
                  {t.split.splitAnother}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t.split.whichCardTitle}>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">
                  {t.split.selectLabel}
                </span>
                <select
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                  value={parent?.key ?? ''}
                  disabled={myIssuesLoading}
                  onChange={(e) => {
                    const issue = myIssues.find((i) => i.key === e.target.value)
                    if (issue) selectParent(issue)
                  }}
                >
                  <option value="" disabled>
                    {t.split.selectPlaceholder}
                  </option>
                  {myIssues.map((issue) => (
                    <option key={issue.key} value={issue.key}>
                      {issue.key} — {truncateSummary(issue.summary)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <Input
                  label={t.split.orManualKey}
                  placeholder={t.split.manualKeyPlaceholder}
                  value={manualKey}
                  onChange={(e) => setManualKey(e.target.value)}
                  className="max-w-48"
                />
                <Button
                  variant="secondary"
                  disabled={getBusy || !manualKey.trim()}
                  onClick={() => void searchManualKey()}
                >
                  {getBusy && <Spinner />}
                  {getBusy ? t.split.searching : t.split.search}
                </Button>
              </div>
              {getError && <p className="text-sm text-red-400 light:text-red-600">{getError}</p>}
            </div>
          </Card>

          {parent && (
            <Card>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-zinc-300">{parent.key}</span>
                  {parent.issueType && <Badge color="indigo">{parent.issueType}</Badge>}
                  {parent.status && (
                    <Badge color={statusColor(parent.statusCategory)}>{parent.status}</Badge>
                  )}
                </div>
                <p className="text-sm font-medium text-zinc-100">{parent.summary}</p>
                {descriptionPreview ? (
                  <p className="line-clamp-6 text-sm whitespace-pre-wrap text-zinc-400">
                    {descriptionPreview}
                  </p>
                ) : (
                  <p className="text-sm text-amber-400 light:text-amber-600">
                    {t.split.noDescription}
                  </p>
                )}
              </div>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <Button disabled={analyzeDisabled} onClick={() => void analyze()}>
              {analyzeBusy ? <Spinner /> : <Sparkles size={14} />}
              {analyzeBusy ? t.split.analyzing : t.split.analyze}
            </Button>
            {!claudeInfo?.available && (
              <span className="text-xs text-amber-400 light:text-amber-600">
                {t.split.claudeUnavailableHint}
              </span>
            )}
          </div>
          {analyzeError && (
            <p className="text-sm text-red-400 light:text-red-600">{analyzeError}</p>
          )}

          {items.length > 0 && (
            <>
              <Card title={t.split.rationaleTitle}>
                <p className="text-sm text-zinc-400">{rationale}</p>
              </Card>

              <Card title={t.split.itemsTitle}>
                <div className="space-y-4">
                  {items.map((item, idx) => (
                    <SplitItemCard
                      key={item.id}
                      item={item}
                      index={idx}
                      onChange={(patch) => updateItem(item.id, patch)}
                      onRemove={() => removeItem(item.id)}
                    />
                  ))}
                  <Button variant="secondary" onClick={addItem}>
                    {t.split.addItem}
                  </Button>
                </div>
              </Card>

              <Card>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-zinc-300">
                    {t.split.feedbackLabel}
                  </span>
                  <textarea
                    className="h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-indigo-600"
                    placeholder={t.split.feedbackPlaceholder}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                </label>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    disabled={analyzeBusy || !claudeInfo?.available || !feedback.trim()}
                    onClick={() => void refine()}
                  >
                    {analyzeBusy ? <Spinner /> : <Sparkles size={14} />}
                    {analyzeBusy ? t.split.refining : t.split.refine}
                  </Button>
                </div>
              </Card>

              <Card title={t.split.structureTitle}>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      className={`flex items-center gap-2 text-sm ${subtaskTypes.length === 0 ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-300'}`}
                    >
                      <input
                        type="radio"
                        className="accent-indigo-600"
                        name="split-mode"
                        checked={effectiveMode === 'subtask'}
                        disabled={subtaskTypes.length === 0}
                        onChange={() => setModeChoice('subtask')}
                      />
                      {t.split.modeSubtask}
                    </label>
                    {subtaskTypes.length === 0 && (
                      <p className="pl-6 text-xs text-amber-400 light:text-amber-600">
                        {t.split.noSubtaskType}
                      </p>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="radio"
                        className="accent-indigo-600"
                        name="split-mode"
                        checked={effectiveMode === 'sibling'}
                        onChange={() => setModeChoice('sibling')}
                      />
                      {t.split.modeSibling}
                    </label>
                  </div>

                  {typeOptions.length > 1 && (
                    <label className="block max-w-64">
                      <span className="mb-1 block text-xs font-medium text-zinc-400">
                        {t.split.issueType}
                      </span>
                      <select
                        className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                        value={effectiveIssueTypeId ?? ''}
                        onChange={(e) => setIssueTypeIdChoice(e.target.value)}
                      >
                        {typeOptions.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      className="accent-indigo-600"
                      checked={assignToMe}
                      onChange={(e) => setAssignToMe(e.target.checked)}
                    />
                    {t.split.assignToMe}
                  </label>
                </div>
              </Card>

              {createError && (
                <p className="text-sm text-red-400 light:text-red-600">{createError}</p>
              )}

              <Button className="w-full" disabled={submitDisabled} onClick={() => void submit()}>
                {createBusy && <Spinner />}
                {createBusy ? t.split.submitting : t.split.submit(items.length)}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  )
}
