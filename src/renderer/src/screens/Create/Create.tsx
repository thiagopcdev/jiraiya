import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { useGlobalSearch, useIssueTypes, useProjects } from '../../api/hooks'
import { Badge, Button, Card, EmptyState, Input, Spinner } from '../../components/ui'
import { MarkdownToolbar } from '../../components/MarkdownToolbar'
import { statusColor } from '../../components/statusColor'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'

/** Primeiras 6 palavras com mais de 2 caracteres, juntas com espaço — consultas
 * FTS longas com AND (todos os termos) ficam restritivas demais. */
function buildDuplicateQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .join(' ')
}

export default function Create(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { openIssue } = useIssueDetail()

  const { data: projectsData } = useProjects()
  const projects = projectsData?.projects ?? []

  const [projectKeyChoice, setProjectKeyChoice] = useState<string | null>(null)
  const [issueTypeIdChoice, setIssueTypeIdChoice] = useState<string | null>(null)

  // Default: primeiro projeto acompanhado, até o usuário escolher outro.
  const projectKey =
    projectKeyChoice ?? (projects.find((p) => p.selected) ?? projects[0])?.key ?? null

  const { data: issueTypesData, isLoading: issueTypesLoading } = useIssueTypes(projectKey)
  const issueTypes = (issueTypesData?.issueTypes ?? []).filter((it) => !it.subtask)
  // Default: primeiro tipo disponível; se a escolha do usuário não existir mais
  // (ex. trocou de projeto), volta a cair no primeiro tipo da lista atual.
  const issueTypeId = issueTypes.some((it) => it.id === issueTypeIdChoice)
    ? issueTypeIdChoice
    : (issueTypes[0]?.id ?? null)
  const selectedIssueType = issueTypes.find((it) => it.id === issueTypeId) ?? null

  const { data: claudeInfo } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })
  const { data: sprintData } = useQuery({
    queryKey: ['sprint-active'],
    queryFn: () => invoke('sprint:active', {})
  })
  const activeSprint = sprintData?.sprint ?? null

  // Prefill vindo do command palette ("criar <ideia>" -> /criar?idea=...). Initializer
  // lazy do useState roda uma única vez, na montagem — sem sobrescrever o que o
  // usuário digitar depois (evita disparar setState de dentro de um effect).
  const [searchParams] = useSearchParams()
  const [idea, setIdea] = useState(() => searchParams.get('idea') ?? '')
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)
  const [assignToMe, setAssignToMe] = useState(true)
  const [addToActiveSprint, setAddToActiveSprint] = useState(false)
  const [storyPoints, setStoryPoints] = useState('')

  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  // Aviso de possíveis duplicados: usa o que estiver preenchido (título/summary do
  // modo manual, senão a ideia do modo Claude), debounced para não bater a busca a
  // cada tecla.
  const duplicateSource = summary.trim() || idea.trim()
  const duplicateQuery = buildDuplicateQuery(duplicateSource)
  const [debouncedDuplicateQuery, setDebouncedDuplicateQuery] = useState('')
  useEffect(() => {
    if (duplicateQuery.length < 3) return
    const timer = setTimeout(() => setDebouncedDuplicateQuery(duplicateQuery), 500)
    return () => clearTimeout(timer)
  }, [duplicateQuery])
  // Some fonte ficou curta demais (ou vazia) desde a última rodada debounced —
  // não mostra resultado obsoleto de uma busca anterior.
  const activeDuplicateQuery = duplicateQuery.length < 3 ? '' : debouncedDuplicateQuery
  const { data: duplicatesData } = useGlobalSearch(activeDuplicateQuery)
  const duplicates = (duplicatesData?.results ?? []).slice(0, 5)

  const resetForm = (): void => {
    setIdea('')
    setSummary('')
    setDescription('')
    setAssignToMe(true)
    setAddToActiveSprint(false)
    setStoryPoints('')
    setDraftError(null)
    setCreateError(null)
    setCreatedKey(null)
  }

  const generateDraft = async (): Promise<void> => {
    if (!projectKey || !selectedIssueType) return
    setDraftBusy(true)
    setDraftError(null)
    try {
      const res = await invoke('issues:draft', {
        idea,
        projectKey,
        issueType: selectedIssueType.name
      })
      setSummary(res.title)
      setDescription(res.description)
    } catch (err) {
      setDraftError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setDraftBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    if (!projectKey || !selectedIssueType) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const points = Number(storyPoints)
      const res = await invoke('issues:create', {
        projectKey,
        issueTypeId: selectedIssueType.id,
        summary,
        description,
        assignToMe,
        addToActiveSprint: activeSprint ? addToActiveSprint : undefined,
        storyPoints: storyPoints.trim() && points > 0 ? points : undefined
      })
      setCreatedKey(res.key)
      openIssue(res.key)
      void invoke('sync:run', { full: false })
      void queryClient.invalidateQueries()
    } catch (err) {
      setCreateError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setCreateBusy(false)
    }
  }

  const draftDisabled =
    draftBusy || !claudeInfo?.available || !idea.trim() || !projectKey || !selectedIssueType
  const submitDisabled = createBusy || !projectKey || !selectedIssueType || !summary.trim()

  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">{t.create.title}</h2>

      {createdKey ? (
        <Card className="border-green-900 bg-green-950/30 light:border-green-300 light:bg-green-50">
          <div className="flex items-start gap-3">
            <CheckCircle2
              className="mt-0.5 shrink-0 text-green-400 light:text-green-600"
              size={20}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">
                {t.create.createdTitle(createdKey)}
              </p>
              <p className="mt-1 text-sm text-zinc-400">{t.create.createdHint}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" onClick={() => openIssue(createdKey)}>
                  Ver card
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void invoke('shell:openIssue', { issueKey: createdKey })}
                >
                  <ExternalLink size={14} />
                  {t.create.openInJira}
                </Button>
                <Button variant="ghost" onClick={resetForm}>
                  {t.create.createAnother}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t.create.whereTitle}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">
                  {t.create.project}
                </span>
                <select
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                  value={projectKey ?? ''}
                  onChange={(e) => {
                    setProjectKeyChoice(e.target.value)
                    setIssueTypeIdChoice(null)
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">
                  {t.create.issueType}
                </span>
                <select
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                  value={issueTypeId ?? ''}
                  disabled={issueTypesLoading || issueTypes.length === 0}
                  onChange={(e) => setIssueTypeIdChoice(e.target.value)}
                >
                  {issueTypes.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </label>
              {issueTypesLoading && (
                <span className="flex items-center gap-2 pb-1.5 text-sm text-zinc-400">
                  <Spinner /> {t.create.loadingIssueTypes}
                </span>
              )}
            </div>
            {!issueTypesLoading && projectKey && issueTypes.length === 0 && (
              <EmptyState message={t.create.noIssueTypes} />
            )}
          </Card>

          <Card title={t.create.aiTitle}>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">
                {t.create.ideaLabel}
              </span>
              <textarea
                className="h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-indigo-600"
                placeholder={t.create.ideaPlaceholder}
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
            </label>
            <div className="mt-3 flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={draftDisabled}
                onClick={() => void generateDraft()}
              >
                {draftBusy ? <Spinner /> : <Sparkles size={14} />}
                {draftBusy ? t.create.generating : t.create.generate}
              </Button>
              {!claudeInfo?.available && (
                <span className="text-xs text-amber-400 light:text-amber-600">
                  {t.create.claudeUnavailableHint}
                </span>
              )}
            </div>
            {draftError && (
              <p className="mt-2 text-sm text-amber-400 light:text-amber-600">{draftError}</p>
            )}
          </Card>

          <Card title={t.create.cardTitle}>
            <div className="space-y-3">
              <Input
                label={t.create.summary}
                value={summary}
                maxLength={255}
                onChange={(e) => setSummary(e.target.value)}
                hint={`${summary.length}/255`}
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-300">
                  {t.create.description}
                </span>
                <MarkdownToolbar
                  textareaRef={descriptionRef}
                  value={description}
                  onChange={setDescription}
                  aiContext="description"
                />
                <textarea
                  ref={descriptionRef}
                  className="h-64 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 outline-none focus:border-indigo-500"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <span className="mt-1 block text-xs text-zinc-500">{t.create.descriptionHint}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={assignToMe}
                  onChange={(e) => setAssignToMe(e.target.checked)}
                />
                {t.create.assignToMe}
              </label>
              {activeSprint && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="accent-indigo-600"
                    checked={addToActiveSprint}
                    onChange={(e) => setAddToActiveSprint(e.target.checked)}
                  />
                  {t.create.addToActiveSprint(activeSprint.name ?? '')}
                </label>
              )}
              <Input
                label={t.create.storyPoints}
                type="number"
                min={0}
                step="1"
                className="max-w-32"
                value={storyPoints}
                onChange={(e) => setStoryPoints(e.target.value)}
                hint={t.create.storyPointsHint}
              />
            </div>
          </Card>

          {activeDuplicateQuery.length >= 3 && duplicates.length > 0 && (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-2 light:border-amber-300 light:bg-amber-50">
              <p className="text-xs font-medium text-amber-400 light:text-amber-700">
                Cards parecidos já existem:
              </p>
              <div className="mt-1.5 space-y-1">
                {duplicates.map((result) => (
                  <div key={result.key} className="flex items-center gap-2">
                    <button
                      className="shrink-0 font-mono text-xs text-indigo-400 hover:underline light:text-indigo-600"
                      onClick={() => openIssue(result.key)}
                    >
                      {result.key}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-400 light:text-zinc-600">
                      {result.summary}
                    </span>
                    {result.status && (
                      <Badge color={statusColor(result.statusCategory)}>{result.status}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {createError && <p className="text-sm text-red-400 light:text-red-600">{createError}</p>}

          <Button className="w-full" disabled={submitDisabled} onClick={() => void submit()}>
            {createBusy && <Spinner />}
            {createBusy ? t.create.submitting : t.create.submit}
          </Button>
        </>
      )}
    </div>
  )
}
