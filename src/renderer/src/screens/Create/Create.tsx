import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { MentionTextarea } from '../../components/MentionTextarea'
import { toMarkdown, type MentionMap } from '../../lib/mentionText'
import {
  useAiStatus,
  useGlobalSearch,
  useIssueTypes,
  useProjects,
  unavailableAiProviderLabel
} from '../../api/hooks'
import { Badge, Button, Card, EmptyState, ScreenHeader, Spinner, Toggle } from '../../components/ui'
import { PairTabs } from '../../components/PairTabs'
import { MarkdownToolbar } from '../../components/MarkdownToolbar'
import { statusColor } from '../../components/statusColor'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'

/**
 * Faixa de abas do par "Criar · Dividir" (item único na sidebar, handoff Tela C).
 * Navegação de verdade — não estado local: a aba ativa é a rota atual.
 */
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

const FIELD_CLASS =
  'w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500'
const SELECT_CLASS =
  'w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200 outline-none focus:border-indigo-500 disabled:text-zinc-500'

/** Rótulo de campo do formulário — versalete miúdo, o padrão do handoff. */
function FieldLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="mb-1.5 block text-[10px] font-bold tracking-[.06em] text-zinc-600 uppercase">
      {children}
    </span>
  )
}

/** Escala usada nos boards da Biud — o campo antes era numérico livre. */
const STORY_POINT_OPTIONS = ['1', '2', '3', '5', '8', '13', '21']

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

  const { data: aiStatus } = useAiStatus()
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
  const mentions = useRef<MentionMap>({})
  const [assignToMe, setAssignToMe] = useState(true)
  const [addToActiveSprint, setAddToActiveSprint] = useState(false)
  const [storyPoints, setStoryPoints] = useState('')

  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  // Aviso de possíveis duplicados: usa o que estiver preenchido (título/summary do
  // modo manual, senão a ideia do modo IA), debounced para não bater a busca a
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
  const showDuplicates = activeDuplicateQuery.length >= 3 && duplicates.length > 0

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
        description: toMarkdown(description, mentions.current),
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
    draftBusy || !aiStatus?.active || !idea.trim() || !projectKey || !selectedIssueType
  const submitDisabled = createBusy || !projectKey || !selectedIssueType || !summary.trim()

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.nav.createSplit} flush />
      <PairTabs
        tabs={[
          { to: '/criar', label: t.nav.create },
          { to: '/dividir', label: t.nav.split }
        ]}
      />

      {createdKey ? (
        <div className="max-w-[720px] p-[18px_24px]">
          <Card className="border-green-600/35 bg-green-600/10">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 shrink-0 text-green-400 light:text-green-600"
                size={20}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-zinc-50">
                  {t.create.createdTitle(createdKey)}
                </p>
                <p className="mt-1 text-[12.5px] text-zinc-400">{t.create.createdHint}</p>
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
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start gap-3.5 overflow-y-auto p-[18px_24px]">
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <Card
              title={
                <span className="flex items-center gap-2.5">
                  <Sparkles size={15} className="text-indigo-400" />
                  Comece pela ideia
                </span>
              }
              actions={
                <span className="text-[11.5px] text-zinc-500">ou preencha à mão abaixo</span>
              }
              bodyClassName="px-4 py-3"
            >
              <div className="flex items-center gap-2.5">
                <input
                  className={FIELD_CLASS}
                  aria-label={t.create.ideaLabel}
                  placeholder={t.create.ideaPlaceholder}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                />
                <Button
                  className="shrink-0"
                  disabled={draftDisabled}
                  onClick={() => void generateDraft()}
                >
                  {draftBusy ? <Spinner /> : <Sparkles size={13} />}
                  {draftBusy ? t.create.generating : 'Rascunhar'}
                </Button>
              </div>
              {!aiStatus?.active && (
                <p className="mt-2 text-[11.5px] text-amber-400 light:text-amber-600">
                  {t.create.aiUnavailableHint(unavailableAiProviderLabel(aiStatus))}
                </p>
              )}
              {draftError && (
                <p className="mt-2 text-[11.5px] text-amber-400 light:text-amber-600">
                  {draftError}
                </p>
              )}
            </Card>

            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2.5">
                  <label className="min-w-0 flex-1">
                    <FieldLabel>{t.create.project}</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={projectKey ?? ''}
                      onChange={(e) => {
                        setProjectKeyChoice(e.target.value)
                        setIssueTypeIdChoice(null)
                      }}
                    >
                      {projects.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key} · {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0 flex-1">
                    <FieldLabel>{t.create.issueType}</FieldLabel>
                    <select
                      className={SELECT_CLASS}
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
                  <label className="w-[110px] shrink-0">
                    <FieldLabel>{t.create.storyPoints}</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value={storyPoints}
                      onChange={(e) => setStoryPoints(e.target.value)}
                    >
                      <option value="">—</option>
                      {STORY_POINT_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {issueTypesLoading && (
                  <span className="flex items-center gap-2 text-[12.5px] text-zinc-400">
                    <Spinner /> {t.create.loadingIssueTypes}
                  </span>
                )}
                {!issueTypesLoading && projectKey && issueTypes.length === 0 && (
                  <EmptyState message={t.create.noIssueTypes} />
                )}

                <label className="block">
                  <FieldLabel>{t.create.summary}</FieldLabel>
                  <input
                    className={FIELD_CLASS}
                    value={summary}
                    maxLength={255}
                    onChange={(e) => setSummary(e.target.value)}
                  />
                </label>

                <div>
                  <div className="flex items-center gap-2">
                    <FieldLabel>{t.create.description}</FieldLabel>
                    <div className="mb-1.5 ml-auto">
                      <MarkdownToolbar
                        className=""
                        textareaRef={descriptionRef}
                        value={description}
                        onChange={setDescription}
                        aiContext="description"
                      />
                    </div>
                  </div>
                  <MentionTextarea
                    textareaRef={descriptionRef}
                    aria-label={t.create.description}
                    className="h-[150px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-zinc-300 outline-none focus:border-indigo-500"
                    value={description}
                    onChange={setDescription}
                    onPick={(user) => (mentions.current[user.displayName] = user.accountId)}
                  />
                  <span className="mt-1 block text-[11.5px] text-zinc-500">
                    {t.create.descriptionHint}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                  <span className="flex items-center gap-2.5 text-[13px] text-zinc-200">
                    <Toggle
                      checked={assignToMe}
                      onChange={setAssignToMe}
                      aria-label={t.create.assignToMe}
                    />
                    {t.create.assignToMe}
                  </span>
                  {activeSprint && (
                    <span className="flex items-center gap-2.5 text-[13px] text-zinc-200">
                      <Toggle
                        checked={addToActiveSprint}
                        onChange={setAddToActiveSprint}
                        aria-label={t.create.addToActiveSprint(activeSprint.name ?? '')}
                      />
                      {t.create.addToActiveSprint(activeSprint.name ?? '')}
                    </span>
                  )}
                  <Button
                    className="ml-auto"
                    disabled={submitDisabled}
                    onClick={() => void submit()}
                  >
                    {createBusy && <Spinner />}
                    {createBusy ? t.create.submitting : 'Criar card'}
                  </Button>
                </div>

                {createError && (
                  <p className="text-[12.5px] text-red-400 light:text-red-600">{createError}</p>
                )}
              </div>
            </Card>
          </div>

          {showDuplicates && (
            <div className="w-[320px] shrink-0">
              <Card
                title={
                  <span className="flex items-center gap-2.5">
                    <AlertTriangle size={15} className="text-amber-400 light:text-amber-600" />
                    Possíveis duplicados
                  </span>
                }
                actions={<Badge color="amber">{duplicates.length}</Badge>}
                bodyClassName="px-4 py-0.5"
              >
                {duplicates.map((result) => (
                  <div
                    key={result.key}
                    className="flex flex-col gap-1 border-b border-zinc-800/60 py-2.5 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        className="font-mono text-[11px] text-indigo-400 hover:underline"
                        onClick={() => openIssue(result.key)}
                      >
                        {result.key}
                      </button>
                      {result.status && (
                        <span className="ml-auto">
                          <Badge color={statusColor(result.statusCategory)}>{result.status}</Badge>
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] leading-[1.4] text-zinc-200">
                      {result.summary}
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
