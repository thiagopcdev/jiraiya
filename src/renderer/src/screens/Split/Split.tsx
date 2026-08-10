import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, PanelRight, Sparkles, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { useAiStatus, useIssueTypes, useIssues, unavailableAiProviderLabel } from '../../api/hooks'
import {
  Badge,
  Button,
  Card,
  ScreenHeader,
  SegmentedControl,
  Spinner,
  Toggle
} from '../../components/ui'
import { PairTabs } from '../../components/PairTabs'
import { statusColor } from '../../components/statusColor'
import { t } from '../../strings/ptBR'
import type { Issue } from '@shared/domain'
import { useIssueDetail } from '../../components/issueDetail'

/**
 * Faixa de abas do par "Criar · Dividir" (item único na sidebar, handoff Tela C).
 * Navegação de verdade — não estado local: a aba ativa é a rota atual.
 */
interface EditableItem {
  id: string
  title: string
  description: string
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

function truncateSummary(summary: string, max = 60): string {
  return summary.length > max ? `${summary.slice(0, max)}…` : summary
}

/**
 * Cartão de uma subtarefa proposta: número em quadrado de 20px, título editável
 * direto na linha (sem moldura de input, que dobraria a altura) e descrição num
 * campo de fundo rebaixado.
 */
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
  return (
    <Card bodyClassName="px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-indigo-600/16 text-[11px] font-bold text-indigo-400">
          {index + 1}
        </span>
        <input
          aria-label={`${t.split.itemTitleLabel} ${index + 1}`}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-[13.5px] font-semibold text-zinc-50 outline-none hover:bg-zinc-950/40 focus:bg-zinc-950/60"
          value={item.title}
          maxLength={255}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <button
          aria-label={t.split.removeItem}
          className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <textarea
        aria-label={`${t.split.itemDescriptionLabel} ${index + 1}`}
        className="mt-2 h-[62px] w-full resize-y rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2 text-[12.5px] leading-[1.55] text-zinc-400 outline-none focus:border-indigo-500"
        value={item.description}
        onChange={(e) => onChange({ description: e.target.value })}
      />
    </Card>
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

  const { data: aiStatus } = useAiStatus()

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

  /**
   * Uma única chamada para as duas situações: sem itens é a primeira análise; com
   * itens é o refino (manda o rascunho atual junto). O texto do campo, quando
   * preenchido, entra como instrução nos dois casos.
   */
  const runAnalysis = async (): Promise<void> => {
    if (!parent) return
    setAnalyzeBusy(true)
    setAnalyzeError(null)
    try {
      const res = await invoke('issues:splitDraft', {
        parentKey: parent.key,
        feedback: feedback.trim() || undefined,
        currentItems:
          items.length > 0
            ? items.map(({ title, description }) => ({ title, description }))
            : undefined
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

  const activeProviderLabel = aiStatus?.active?.label ?? null
  // Refino sem instrução nenhuma só gastaria uma chamada de IA para devolver
  // quase o mesmo rascunho — o gate de texto obrigatório vem de antes da fusão
  // das duas ações num botão só.
  const analyzeDisabled =
    analyzeBusy || !parent || !aiStatus?.active || (items.length > 0 && !feedback.trim())
  const submitDisabled =
    createBusy ||
    items.length === 0 ||
    items.some((it) => !it.title.trim()) ||
    !effectiveIssueTypeId

  const plural = items.length === 1 ? '' : 's'
  const countLabel =
    effectiveMode === 'subtask'
      ? `${items.length} subtarefa${plural}`
      : `${items.length} card${plural} irmão${plural}`
  const submitLabel =
    effectiveMode === 'subtask'
      ? `Criar ${items.length} subtarefa${plural}`
      : `Criar ${items.length} card${plural} irmão${plural}`

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t.nav.createSplit} flush />
      <PairTabs
        tabs={[
          { to: '/criar', label: t.nav.create },
          { to: '/dividir', label: t.nav.split }
        ]}
      />

      {createdKeys ? (
        <div className="max-w-[720px] p-[18px_24px]">
          <Card className="border-green-600/35 bg-green-600/10">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 shrink-0 text-green-400 light:text-green-600"
                size={20}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-zinc-50">
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
                  <p className="mt-3 text-[12.5px] text-amber-400 light:text-amber-600">
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
                    onClick={() =>
                      parent && void invoke('shell:openIssue', { issueKey: parent.key })
                    }
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
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start gap-3.5 overflow-y-auto p-[18px_24px]">
          <div className="flex w-[330px] shrink-0 flex-col gap-3.5">
            <Card title="Card a dividir">
              {parent ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11.5px] font-semibold text-indigo-400">
                      {parent.key}
                    </span>
                    {parent.status && (
                      <Badge color={statusColor(parent.statusCategory)}>{parent.status}</Badge>
                    )}
                    {parent.storyPoints != null && (
                      <span className="ml-auto rounded-sm bg-zinc-800 px-1.5 py-0.5 text-[10.5px] font-bold text-zinc-400">
                        {parent.storyPoints}
                      </span>
                    )}
                  </div>
                  <p className="text-[13.5px] leading-[1.4] text-zinc-50">{parent.summary}</p>
                  {!parent.descriptionText && (
                    <p className="text-[11.5px] text-amber-400 light:text-amber-600">
                      {t.split.noDescription}
                    </p>
                  )}
                  <button
                    className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-zinc-500 transition-colors hover:text-zinc-300"
                    onClick={() => setParent(null)}
                  >
                    <PanelRight size={12} />
                    trocar card
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="block">
                    <FieldLabel>{t.split.selectLabel}</FieldLabel>
                    <select
                      className={SELECT_CLASS}
                      value=""
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
                    <label className="min-w-0 flex-1">
                      <FieldLabel>{t.split.orManualKey}</FieldLabel>
                      <input
                        className={FIELD_CLASS}
                        placeholder={t.split.manualKeyPlaceholder}
                        value={manualKey}
                        onChange={(e) => setManualKey(e.target.value)}
                      />
                    </label>
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      disabled={getBusy || !manualKey.trim()}
                      onClick={() => void searchManualKey()}
                    >
                      {getBusy && <Spinner />}
                      {getBusy ? t.split.searching : t.split.search}
                    </Button>
                  </div>
                  {getError && (
                    <p className="text-[12.5px] text-red-400 light:text-red-600">{getError}</p>
                  )}
                </div>
              )}
            </Card>

            {parent && (
              <Card
                title={
                  <span className="flex items-center gap-2.5">
                    <Sparkles size={15} className="text-indigo-400" />
                    {items.length === 0 ? 'Analisar com IA' : 'Refinar a análise'}
                  </span>
                }
              >
                <div className="flex flex-col gap-2.5">
                  <textarea
                    aria-label={t.split.feedbackLabel}
                    className="h-[74px] w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-2 text-[12.5px] leading-[1.5] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
                    placeholder={t.split.feedbackPlaceholder}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={analyzeDisabled}
                    onClick={() => void runAnalysis()}
                  >
                    {analyzeBusy ? <Spinner /> : <Sparkles size={12} />}
                    {analyzeBusy
                      ? t.split.analyzing
                      : items.length === 0
                        ? t.split.analyze(activeProviderLabel)
                        : 'Analisar de novo'}
                  </Button>
                  {!aiStatus?.active && (
                    <p className="text-[11.5px] text-amber-400 light:text-amber-600">
                      {t.split.aiUnavailableHint(unavailableAiProviderLabel(aiStatus))}
                    </p>
                  )}
                  {analyzeError && (
                    <p className="text-[12.5px] text-red-400 light:text-red-600">{analyzeError}</p>
                  )}
                </div>
              </Card>
            )}

            {parent && items.length > 0 && (
              <Card title="Como criar">
                <div className="flex flex-col gap-3">
                  <SegmentedControl
                    aria-label="Como criar"
                    options={
                      subtaskTypes.length > 0
                        ? [
                            { value: 'subtask' as const, label: 'Subtarefas' },
                            { value: 'sibling' as const, label: 'Cards irmãos' }
                          ]
                        : [{ value: 'sibling' as const, label: 'Cards irmãos' }]
                    }
                    value={effectiveMode}
                    onChange={setModeChoice}
                  />
                  {subtaskTypes.length === 0 && (
                    <p className="text-[11.5px] text-amber-400 light:text-amber-600">
                      {t.split.noSubtaskType}
                    </p>
                  )}

                  {typeOptions.length > 1 && (
                    <label className="block">
                      <FieldLabel>{t.split.issueType}</FieldLabel>
                      <select
                        className={SELECT_CLASS}
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

                  <span className="flex items-center gap-2.5 text-[13px] text-zinc-200">
                    <Toggle
                      checked={assignToMe}
                      onChange={setAssignToMe}
                      aria-label={t.split.assignToMe}
                    />
                    {t.split.assignToMe}
                  </span>

                  <Button
                    className="w-full"
                    disabled={submitDisabled}
                    onClick={() => void submit()}
                  >
                    {createBusy && <Spinner />}
                    {createBusy ? t.split.submitting : submitLabel}
                  </Button>
                  {createError && (
                    <p className="text-[12.5px] text-red-400 light:text-red-600">{createError}</p>
                  )}
                </div>
              </Card>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-bold text-zinc-50">Divisão proposta</h3>
              {items.length > 0 && <Badge color="brand">{countLabel}</Badge>}
              {items.length > 0 && (
                <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-zinc-500">
                  <Sparkles size={12} />
                  {[activeProviderLabel, 'edite antes de criar'].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>

            {rationale && (
              <p className="max-w-[70ch] border-l-2 border-zinc-700 pl-3 text-[12.5px] leading-[1.6] text-zinc-400">
                {rationale}
              </p>
            )}

            {items.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 px-4 py-2.5 text-[12.5px] text-zinc-500">
                {analyzeBusy && <Spinner className="text-zinc-500" />}
                {analyzeBusy
                  ? t.split.analyzing
                  : parent
                    ? 'Analise o card para ver a divisão proposta.'
                    : 'Escolha um card à esquerda para começar.'}
              </div>
            ) : (
              <>
                {items.map((item, idx) => (
                  <SplitItemCard
                    key={item.id}
                    item={item}
                    index={idx}
                    onChange={(patch) => updateItem(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
                <div>
                  <Button variant="ghost" onClick={addItem}>
                    {t.split.addItem}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
