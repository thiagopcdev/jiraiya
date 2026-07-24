import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Link2,
  ChevronRight,
  ExternalLink,
  Flag,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Ruler,
  Sparkles,
  Trash2,
  UserRound,
  X,
  Zap
} from 'lucide-react'
import type { ActivityKind, CreateIssueType, Issue, IssueActivity } from '@shared/domain'
import type { IpcRequest, IpcResponse } from '@shared/ipc-contract'
import { invoke, IpcError } from '../api/client'
import {
  useAuthStatus,
  useIssueActivity,
  useIssueSearch,
  useIssueTypes,
  useLinkTypes,
  useMoveTargets,
  usePrsForIssue,
  usePrStatus,
  useSprintList,
  useWorklogs
} from '../api/hooks'
import { Badge, Button, EmptyState, Input, Spinner } from './ui'
import { AdfView } from './AdfView'
import { AttachmentsSection, useMediaResolver } from './attachments'
import { statusColor } from './statusColor'
import { IssueDetailContext, useIssueDetail } from './issueDetail'
import { t } from '../strings/ptBR'
import { formatJiraDuration, formatTimer, useIssueTimer } from '../lib/timer'

const kindMeta: Record<ActivityKind, { icon: typeof Zap; label: string; color: string }> = {
  created: { icon: Plus, label: 'criou', color: 'text-zinc-400' },
  status_change: { icon: ArrowRightLeft, label: 'moveu', color: 'text-blue-400' },
  resolved: { icon: CheckCircle2, label: 'resolveu', color: 'text-green-400' },
  assignment: { icon: UserRound, label: 'atribuiu', color: 'text-amber-400' },
  comment: { icon: MessageSquare, label: 'comentou', color: 'text-indigo-400' },
  sprint_change: { icon: Zap, label: 'mudou sprint', color: 'text-purple-400' },
  priority_change: { icon: Flag, label: 'mudou prioridade', color: 'text-red-400' },
  estimate_change: { icon: Ruler, label: 'estimou', color: 'text-teal-400' }
}

const DESCRIPTION_LINE_LIMIT = 50

/** valor sentinela do select de Responsável — selecioná-lo remove o assignee */
const UNASSIGNED_ASSIGNEE = '__unassigned__'

interface AssigneeOption {
  id: string
  label: string
  /** nome a enviar no update (null = remover); distinto do label, que pode ter o sufixo " (eu)" */
  displayName: string | null
}

/**
 * Monta as opções do select de Responsável: o valor atual sempre primeiro, depois
 * "eu" (rotulado), os demais em ordem alfabética e por fim "Sem responsável" — sem
 * duplicar quem já apareceu antes. Se a lista de assignable falhar, degrada para
 * só "eu" (rotulada "Atribuir a mim") + "Sem responsável" além do valor atual.
 */
function buildAssigneeOptions(
  issue: Issue,
  users: Array<{ accountId: string; displayName: string }>,
  myAccountId: string | null,
  myDisplayName: string | null,
  assignableFailed: boolean
): AssigneeOption[] {
  const options: AssigneeOption[] = []
  const seen = new Set<string>()
  const push = (id: string, label: string, displayName: string | null): void => {
    if (seen.has(id)) return
    seen.add(id)
    options.push({ id, label, displayName })
  }

  push(
    issue.assigneeAccountId ?? UNASSIGNED_ASSIGNEE,
    issue.assigneeName ?? t.detail.unassigned,
    issue.assigneeName
  )

  if (myAccountId) {
    const me = users.find((u) => u.accountId === myAccountId)
    if (me) {
      push(me.accountId, `${me.displayName}${t.detail.meSuffix}`, me.displayName)
    } else if (assignableFailed) {
      push(myAccountId, t.create.assignToMe, myDisplayName)
    }
  }

  users
    .filter((u) => u.accountId !== myAccountId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'))
    .forEach((u) => push(u.accountId, u.displayName, u.displayName))

  push(UNASSIGNED_ASSIGNEE, t.detail.unassigned, null)

  return options
}

export function IssueDetailProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // pilha de navegação interna do drawer: abrir um pai/subtarefa/vínculo empilha por
  // cima do card atual; "voltar" desempilha; fechar limpa tudo de uma vez.
  const [stack, setStack] = useState<string[]>([])

  const openIssue = (key: string): void => {
    setStack((prev) => {
      if (prev.length === 0) return [key]
      if (prev[prev.length - 1] === key) return prev
      return [...prev, key]
    })
  }
  const close = (): void => setStack([])
  const back = (): void => setStack((prev) => prev.slice(0, -1))

  useEffect(() => {
    if (stack.length === 0) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : []))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stack.length])

  const topKey = stack[stack.length - 1] ?? null

  return (
    <IssueDetailContext.Provider value={{ openIssue, close }}>
      {children}
      {topKey && (
        <IssueDetailDrawer
          key={topKey}
          issueKey={topKey}
          onClose={close}
          onBack={stack.length > 1 ? back : null}
        />
      )}
    </IssueDetailContext.Provider>
  )
}

function IssueDetailDrawer({
  issueKey,
  onClose,
  onBack
}: {
  issueKey: string
  onClose: () => void
  onBack: (() => void) | null
}): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  const queryClient = useQueryClient()

  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const { data: issueData, isLoading: issueLoading } = useQuery({
    queryKey: ['issue', issueKey],
    queryFn: () => invoke('issues:get', { key: issueKey })
  })
  const issue = issueData?.issue ?? null

  const { data: activityData, isLoading: activityLoading } = useIssueActivity(issueKey)
  const activities = activityData?.activities ?? []

  // comentários vivos do Jira (ADF formatado); offline/erro → fallback pro texto local
  const {
    data: liveComments,
    isLoading: commentsLoading,
    isError: commentsOffline
  } = useQuery({
    queryKey: ['issue-comments', issueKey],
    queryFn: () => invoke('issues:comments', { key: issueKey }),
    staleTime: 30_000,
    retry: 0
  })
  const localComments = activities.filter((a) => a.kind === 'comment' && a.bodyText)

  // descrição ao vivo (ADF formatado); erro/carregando → fallback pro texto local
  const { data: liveDescription } = useQuery({
    queryKey: ['issue-description', issueKey],
    queryFn: () => invoke('issues:description', { key: issueKey }),
    staleTime: 30_000,
    retry: 0
  })

  const { data: claudeInfo } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })
  const { data: sprintsData } = useSprintList()
  const sprintName =
    issue?.sprintJiraId != null
      ? (sprintsData?.sprints.find((s) => s.jiraId === issue.sprintJiraId)?.name ?? null)
      : null

  // transições disponíveis pro select "Mover para…" no header
  const { data: transitionsData } = useQuery({
    queryKey: ['issue-transitions', issueKey],
    queryFn: () => invoke('issues:transitions', { key: issueKey }),
    enabled: !!issue
  })
  const [selectedTransitionId, setSelectedTransitionId] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [moveSuccess, setMoveSuccess] = useState(false)
  const [timerError, setTimerError] = useState<string | null>(null)

  const invalidateAfterTransition = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['issue', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['issue-transitions', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['issue-activity', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['board'] })
    void queryClient.invalidateQueries({ queryKey: ['issues'] })
  }

  const handleTransitionChange = async (transitionId: string): Promise<void> => {
    if (!transitionId) return
    setMoveBusy(true)
    setMoveError(null)
    try {
      await invoke('issues:transition', { key: issueKey, transitionId })
      invalidateAfterTransition()
      setMoveSuccess(true)
      setTimeout(() => setMoveSuccess(false), 3000)
    } catch (err) {
      const message = err instanceof IpcError ? err.message : t.common.error
      setMoveError(message)
      setTimeout(() => setMoveError(null), 6000)
    } finally {
      setMoveBusy(false)
      setSelectedTransitionId('')
    }
  }

  // subtarefas locais, vínculos ao vivo (podem falhar offline) e navegação para o pai
  const { data: childrenData } = useQuery({
    queryKey: ['issue-children', issueKey],
    queryFn: () => invoke('issues:children', { key: issueKey }),
    enabled: !!issue
  })
  const children = childrenData?.issues ?? []

  const { data: linksData, isError: linksError } = useQuery({
    queryKey: ['issue-links', issueKey],
    queryFn: () => invoke('issues:links', { key: issueKey }),
    enabled: !!issue,
    retry: 0
  })
  const links = linksData?.links ?? []

  // tipo de subtarefa do projeto do card (primeiro com subtask=true) — controla se o
  // botão "+ Subtarefa" aparece
  const { data: issueTypesData } = useIssueTypes(issue?.projectKey ?? null, true)
  const subtaskType = issueTypesData?.issueTypes.find((it) => it.subtask) ?? null
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false)
  const [linkFormOpen, setLinkFormOpen] = useState(false)

  // sempre visível: a seção "Vinculados" agora oferece "+ Vincular" mesmo sem
  // nenhum vínculo/pai/subtarefa ainda existente
  const showRelatedSection = true

  // resolve nós media do ADF (descrição e comentários) para thumbs de anexo já carregados
  const mediaResolver = useMediaResolver(issueKey)

  const { data: authStatus } = useAuthStatus()
  const myAccountId = authStatus?.workspace?.accountId ?? null

  // seção "Editar" em accordion, fechada por padrão — dispara editMeta só ao expandir
  const [editOpen, setEditOpen] = useState(false)
  const { data: editMeta, isLoading: editMetaLoading } = useQuery({
    queryKey: ['issue-editmeta', issueKey],
    queryFn: () => invoke('issues:editMeta', { key: issueKey }),
    enabled: editOpen
  })

  const [descExpanded, setDescExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentSent, setCommentSent] = useState(false)

  const [aiOpen, setAiOpen] = useState(false)
  // timeline em accordion, fechada por padrão
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [aiNotes, setAiNotes] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const openInJira = (): void => void invoke('shell:openIssue', { issueKey })

  const [shareCopied, setShareCopied] = useState(false)
  const shareIssue = async (): Promise<void> => {
    const url =
      issue?.url ?? `${authStatus?.workspace?.siteUrl?.replace(/\/$/, '') ?? ''}/browse/${issueKey}`
    await invoke('export:clipboard', { text: url })
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  const submitComment = async (): Promise<void> => {
    if (!comment.trim()) return
    setCommentBusy(true)
    setCommentError(null)
    try {
      await invoke('issues:comment', { issueKey, body: comment.trim() })
      setComment('')
      setCommentSent(true)
      void invoke('sync:run', { full: false })
      void queryClient.invalidateQueries({ queryKey: ['issue-activity', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['issue-comments', issueKey] })
      setTimeout(() => setCommentSent(false), 3000)
    } catch (err) {
      setCommentError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setCommentBusy(false)
    }
  }

  const generateCommentDraft = async (): Promise<void> => {
    if (!aiNotes.trim()) return
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await invoke('issues:commentDraft', { issueKey, notes: aiNotes.trim() })
      setComment(res.body)
      setAiOpen(false)
      setAiNotes('')
    } catch (err) {
      setAiError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setAiBusy(false)
    }
  }

  const statusSegments = issue ? buildStatusSegments(issue, activities) : []

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`absolute inset-y-0 right-0 flex h-full w-[560px] max-w-[90vw] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={onBack}
                aria-label={t.detail.backLabel}
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <span className="shrink-0 font-mono text-sm whitespace-nowrap text-zinc-400 select-text">
              {issueKey}
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {issue?.statusCategory && (
                <Badge color={statusColor(issue.statusCategory)}>{issue.status}</Badge>
              )}
              {issue?.issueType && <Badge color="zinc">{issue.issueType}</Badge>}
            </div>
            <TimerControl issueKey={issueKey} onError={setTimerError} />
            <button
              className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => void shareIssue()}
              title={shareCopied ? t.detail.shareCopied : t.detail.share}
              aria-label={t.detail.share}
            >
              {shareCopied ? (
                <CheckCircle2 size={15} className="text-green-400" />
              ) : (
                <Link2 size={15} />
              )}
            </button>
            <button
              className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={openInJira}
              title={t.detail.openInJira}
              aria-label={t.detail.openInJira}
            >
              <ExternalLink size={15} />
            </button>
            <button
              className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={onClose}
              aria-label={t.detail.close}
            >
              <X size={16} />
            </button>
          </div>
          {transitionsData && transitionsData.transitions.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <select
                value={selectedTransitionId}
                disabled={moveBusy}
                title={moveBusy ? t.detail.moving : t.detail.moveTo}
                onChange={(e) => {
                  setSelectedTransitionId(e.target.value)
                  void handleTransitionChange(e.target.value)
                }}
                className="max-w-72 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-300 outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                <option value="" disabled>
                  {t.detail.moveTo}
                </option>
                {transitionsData.transitions.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name} → {tr.toStatusName}
                  </option>
                ))}
              </select>
              {moveBusy && <Spinner className="text-zinc-500" />}
              {!moveBusy && moveSuccess && (
                <span title={t.detail.moved}>
                  <CheckCircle2 size={14} className="text-green-400" />
                </span>
              )}
            </div>
          )}
        </div>
        {moveError && (
          <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
            <p className="text-sm text-amber-400">{moveError}</p>
          </div>
        )}
        {timerError && (
          <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
            <p className="text-sm text-amber-400">{timerError}</p>
          </div>
        )}

        {/* select-text: o app usa user-select none global; aqui o conteúdo é copiável */}
        <div className="min-h-0 flex-1 overflow-y-auto select-text">
          {issueLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="text-zinc-500" />
            </div>
          ) : !issue ? (
            <div className="p-6">
              <EmptyState message={t.detail.notSynced} />
              <div className="mt-3 flex justify-center">
                <Button onClick={openInJira}>
                  <ExternalLink size={14} />
                  {t.detail.openInJira}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-4">
              <div>
                <EditableTitle issue={issue} issueKey={issueKey} />
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  {issue.assigneeName && (
                    <span className="flex items-center gap-1">
                      <UserRound size={12} /> {issue.assigneeName}
                    </span>
                  )}
                  {issue.storyPoints !== null && (
                    <span className="flex items-center gap-1">
                      <Ruler size={12} /> {t.detail.storyPoints(issue.storyPoints)}
                    </span>
                  )}
                  {issue.priority && (
                    <span className="flex items-center gap-1">
                      <Flag size={12} /> {issue.priority}
                    </span>
                  )}
                  {sprintName && (
                    <span className="flex items-center gap-1">
                      <Zap size={12} /> {sprintName}
                    </span>
                  )}
                </div>
              </div>

              <section>
                <button
                  className="flex w-full items-center gap-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
                  onClick={() => setEditOpen((v) => !v)}
                >
                  {editOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t.detail.editTitle}
                </button>
                {editOpen && (
                  <div className="mt-2">
                    {editMetaLoading ? (
                      <Spinner className="text-zinc-500" />
                    ) : editMeta ? (
                      <EditPanel meta={editMeta} issue={issue} issueKey={issueKey} />
                    ) : null}
                  </div>
                )}
              </section>

              <DescriptionSection
                issue={issue}
                issueKey={issueKey}
                liveDescription={liveDescription?.description ?? null}
                mediaResolver={mediaResolver}
                descExpanded={descExpanded}
                onExpand={() => setDescExpanded(true)}
              />

              {statusSegments.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {t.detail.timeInStatus}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {statusSegments.map((seg) => (
                      <Badge key={seg.status} color="zinc">
                        {seg.status} · {formatDays(seg.durationMs)}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {showRelatedSection && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {t.detail.relatedTitle}
                  </h3>
                  <div className="space-y-3">
                    {issue.parentKey && (
                      <button
                        className="block text-left text-sm text-indigo-400 hover:underline"
                        onClick={() => openIssue(issue.parentKey!)}
                      >
                        {t.detail.parentLabel}: {issue.parentKey}
                      </button>
                    )}
                    {(children.length > 0 || subtaskType) && (
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-xs text-zinc-500">
                            {t.detail.subtasksTitle(children.length)}
                          </p>
                          {subtaskType && !subtaskFormOpen && (
                            <button
                              className="text-xs text-indigo-400 hover:underline"
                              onClick={() => setSubtaskFormOpen(true)}
                            >
                              {t.detail.addSubtask}
                            </button>
                          )}
                        </div>
                        {children.length > 0 && (
                          <div className="space-y-1">
                            {children.map((child) => (
                              <button
                                key={child.key}
                                className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-900"
                                onClick={() => openIssue(child.key)}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {child.key} — {child.summary}
                                </span>
                                {child.statusCategory && (
                                  <Badge color={statusColor(child.statusCategory)}>
                                    {child.status}
                                  </Badge>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {subtaskFormOpen && subtaskType && (
                          <div className="mt-2">
                            <SubtaskCreateForm
                              issue={issue}
                              issueKey={issueKey}
                              subtaskType={subtaskType}
                              onCreated={(key) => {
                                setSubtaskFormOpen(false)
                                openIssue(key)
                              }}
                              onCancel={() => setSubtaskFormOpen(false)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs text-zinc-500">{t.detail.linksTitle}</p>
                        {!linkFormOpen && (
                          <button
                            className="text-xs text-indigo-400 hover:underline"
                            onClick={() => setLinkFormOpen(true)}
                          >
                            + Vincular
                          </button>
                        )}
                      </div>
                      {links.length > 0 ? (
                        <div className="space-y-1">
                          {links.map((link) => (
                            <button
                              key={`${link.label}-${link.key}`}
                              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-900"
                              onClick={() => openIssue(link.key)}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {link.label}: {link.key} — {link.summary ?? ''}
                              </span>
                              {link.statusCategory && (
                                <Badge color={statusColor(link.statusCategory)}>
                                  {link.status}
                                </Badge>
                              )}
                            </button>
                          ))}
                        </div>
                      ) : linksError ? (
                        <p className="text-xs text-zinc-600">{t.detail.linksOffline}</p>
                      ) : (
                        <p className="text-xs text-zinc-600">Nenhum vínculo ainda.</p>
                      )}
                      {linkFormOpen && (
                        <div className="mt-2">
                          <LinkCreateForm
                            issueKey={issueKey}
                            onClose={() => setLinkFormOpen(false)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              <PullRequestsSection issueKey={issueKey} />

              <AttachmentsSection issueKey={issueKey} />

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  {t.detail.commentsTitle}
                  {liveComments && liveComments.comments.length > 0 && (
                    <span className="ml-1.5 text-zinc-600">({liveComments.comments.length})</span>
                  )}
                </h3>
                {commentsLoading ? (
                  <Spinner className="text-zinc-500" />
                ) : liveComments ? (
                  liveComments.comments.length === 0 ? (
                    <p className="text-sm text-zinc-500">{t.detail.noComments}</p>
                  ) : (
                    <div className="space-y-2">
                      {liveComments.comments.map((c) => (
                        <CommentItem
                          key={c.id}
                          comment={c}
                          issueKey={issueKey}
                          myAccountId={myAccountId}
                          mediaResolver={mediaResolver}
                        />
                      ))}
                    </div>
                  )
                ) : commentsOffline && localComments.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-600">{t.detail.commentsOfflineHint}</p>
                    {localComments.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5"
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-zinc-300">
                            {c.actorName ?? 'Alguém'}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-600">
                            {format(new Date(c.occurredAt), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap text-zinc-400">{c.bodyText}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">{t.detail.noComments}</p>
                )}
              </section>

              <section>
                <button
                  className="flex w-full items-center gap-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
                  onClick={() => setTimelineOpen((v) => !v)}
                >
                  {timelineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t.detail.cardTimeline}
                  {!activityLoading && <span className="text-zinc-600">({activities.length})</span>}
                </button>
                {timelineOpen && (
                  <div className="mt-2">
                    {activityLoading ? (
                      <Spinner className="text-zinc-500" />
                    ) : activities.length === 0 ? (
                      <p className="text-sm text-zinc-500">{t.detail.noActivity}</p>
                    ) : (
                      <div className="space-y-0.5 border-l border-zinc-800 pl-3">
                        {activities.map((a) => (
                          <ActivityLine key={a.id} activity={a} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="space-y-2 border-t border-zinc-800 pt-4">
                <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  {t.detail.commentTitle}
                </h3>
                {aiOpen && (
                  <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <textarea
                      className="h-16 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-200 outline-none focus:border-indigo-600"
                      placeholder={t.detail.aiNotesPlaceholder}
                      value={aiNotes}
                      onChange={(e) => setAiNotes(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        disabled={aiBusy || !aiNotes.trim()}
                        onClick={() => void generateCommentDraft()}
                      >
                        {aiBusy ? <Spinner /> : <Sparkles size={14} />}
                        {aiBusy ? t.detail.aiGenerating : t.detail.aiGenerate}
                      </Button>
                      <Button variant="ghost" onClick={() => setAiOpen(false)}>
                        {t.common.cancel}
                      </Button>
                    </div>
                    {aiError && <p className="text-sm text-amber-400">{aiError}</p>}
                  </div>
                )}
                <textarea
                  className="h-24 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
                  placeholder={t.detail.commentPlaceholder}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    disabled={commentBusy || !comment.trim()}
                    onClick={() => void submitComment()}
                  >
                    {commentBusy ? <Spinner /> : commentSent ? <CheckCircle2 size={14} /> : null}
                    {commentBusy ? t.detail.commentSending : t.detail.commentSubmit}
                  </Button>
                  {!aiOpen && (
                    <Button
                      variant="secondary"
                      disabled={!claudeInfo?.available}
                      title={!claudeInfo?.available ? t.detail.claudeUnavailableHint : undefined}
                      onClick={() => setAiOpen(true)}
                    >
                      <Sparkles size={14} />
                      {t.detail.aiStructure}
                    </Button>
                  )}
                </div>
                {commentError && <p className="text-sm text-amber-400">{commentError}</p>}
                {!claudeInfo?.available && (
                  <p className="text-xs text-zinc-600">{t.detail.claudeUnavailableHint}</p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Conteúdo da seção "Editar". Só é montado quando o editMeta já resolveu, então os
 * useState abaixo podem ser inicializados diretamente pelas props — sem useEffect de
 * sincronização.
 */
function EditPanel({
  meta,
  issue,
  issueKey
}: {
  meta: IpcResponse<'issues:editMeta'>
  issue: Issue
  issueKey: string
}): React.JSX.Element {
  const queryClient = useQueryClient()

  const { data: authStatus } = useAuthStatus()
  const myAccountId = authStatus?.workspace?.accountId ?? null
  const myDisplayName = authStatus?.workspace?.displayName ?? null

  const { data: assignableData, isError: assignableFailed } = useQuery({
    queryKey: ['issue-assignable', issueKey],
    queryFn: () => invoke('issues:assignable', { key: issueKey }),
    retry: 0
  })
  const assigneeOptions = buildAssigneeOptions(
    issue,
    assignableFailed ? [] : (assignableData?.users ?? []),
    myAccountId,
    myDisplayName,
    assignableFailed
  )

  const initialStoryPoints = issue.storyPoints !== null ? String(issue.storyPoints) : ''
  const initialPriorityId = meta.priority.editable
    ? (meta.priority.options.find((o) => o.name === meta.priority.current)?.id ??
      meta.priority.options[0]?.id ??
      '')
    : ''
  const initialSeverityId = meta.severity
    ? (meta.severity.options.find((o) => o.value === meta.severity?.current)?.id ?? '')
    : ''
  const initialOriginalEstimate = meta.originalEstimate ?? ''

  const initialAssigneeId = issue.assigneeAccountId ?? UNASSIGNED_ASSIGNEE
  const initialSprintTarget = issue.sprintJiraId != null ? String(issue.sprintJiraId) : ''

  const [storyPoints, setStoryPoints] = useState(initialStoryPoints)
  const [priorityId, setPriorityId] = useState(initialPriorityId)
  const [severityId, setSeverityId] = useState(initialSeverityId)
  const [originalEstimate, setOriginalEstimate] = useState(initialOriginalEstimate)
  const [assigneeId, setAssigneeId] = useState(initialAssigneeId)
  const [sprintTarget, setSprintTarget] = useState(initialSprintTarget)

  const { data: moveTargetsData } = useMoveTargets(true)

  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [registered, setRegistered] = useState(meta.timeSpent)
  const [timeSpentInput, setTimeSpentInput] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logSaved, setLogSaved] = useState(false)
  const [worklogsOpen, setWorklogsOpen] = useState(false)

  const storyPointsDirty = meta.storyPointsEditable && storyPoints !== initialStoryPoints
  const priorityDirty = meta.priority.editable && priorityId !== initialPriorityId
  const severityDirty =
    meta.severity !== null && severityId !== '' && severityId !== initialSeverityId
  const originalEstimateDirty =
    meta.timeTrackingEditable &&
    originalEstimate.trim() !== '' &&
    originalEstimate !== initialOriginalEstimate
  const assigneeDirty = assigneeId !== initialAssigneeId
  const sprintDirty = sprintTarget !== '' && sprintTarget !== initialSprintTarget
  const dirty =
    storyPointsDirty ||
    priorityDirty ||
    severityDirty ||
    originalEstimateDirty ||
    assigneeDirty ||
    sprintDirty

  const invalidateAfterSave = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['issue', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['board'] })
    void queryClient.invalidateQueries({ queryKey: ['issues'] })
  }

  const handleSave = async (): Promise<void> => {
    if (!dirty) return
    setSaveBusy(true)
    setSaveError(null)
    try {
      const payload: IpcRequest<'issues:update'> = { key: issueKey }
      if (storyPointsDirty) {
        payload.storyPoints = storyPoints.trim() === '' ? null : Number(storyPoints)
      }
      if (priorityDirty) {
        const opt = meta.priority.options.find((o) => o.id === priorityId)
        payload.priorityId = priorityId
        if (opt) payload.priorityName = opt.name
      }
      if (severityDirty && meta.severity) {
        payload.severity = { fieldId: meta.severity.fieldId, optionId: severityId }
      }
      if (originalEstimateDirty) {
        payload.originalEstimate = originalEstimate.trim()
      }
      if (assigneeDirty) {
        if (assigneeId === UNASSIGNED_ASSIGNEE) {
          payload.assigneeAccountId = null
          payload.assigneeName = null
        } else {
          payload.assigneeAccountId = assigneeId
          payload.assigneeName =
            assigneeOptions.find((o) => o.id === assigneeId)?.displayName ?? null
        }
      }
      await invoke('issues:update', payload)
      if (sprintDirty) {
        const target = sprintTarget === 'backlog' ? 'backlog' : Number(sprintTarget)
        await invoke('sprint:moveIssue', { key: issueKey, target })
      }
      setSaved(true)
      invalidateAfterSave()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setSaveBusy(false)
    }
  }

  const handleLogWork = async (): Promise<void> => {
    if (!timeSpentInput.trim()) return
    setLogBusy(true)
    setLogError(null)
    try {
      const res = await invoke('issues:logWork', {
        key: issueKey,
        timeSpent: timeSpentInput.trim()
      })
      setRegistered(res.totalTimeSpent)
      setTimeSpentInput('')
      setLogSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
      setTimeout(() => setLogSaved(false), 3000)
    } catch (err) {
      setLogError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setLogBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="space-y-2">
        <div className="grid grid-cols-[130px_1fr] items-center gap-2">
          <span className="text-xs text-zinc-500">{t.detail.assigneeLabel}</span>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[130px_1fr] items-center gap-2">
          <span className="text-xs text-zinc-500">Sprint</span>
          <select
            value={sprintTarget}
            onChange={(e) => setSprintTarget(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            {sprintTarget === '' && (
              <option value="" disabled>
                Mover para…
              </option>
            )}
            <option value="backlog">Backlog</option>
            {(moveTargetsData?.sprints ?? []).map((s) => (
              <option key={s.jiraId} value={String(s.jiraId)}>
                {(s.name ?? `Sprint ${s.jiraId}`) + (s.state === 'active' ? ' (ativa)' : '')}
              </option>
            ))}
          </select>
        </div>
        {meta.storyPointsEditable && (
          <div className="grid grid-cols-[130px_1fr] items-center gap-2">
            <span className="text-xs text-zinc-500">{t.detail.storyPointsLabel}</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>
        )}
        {meta.priority.editable && (
          <div className="grid grid-cols-[130px_1fr] items-center gap-2">
            <span className="text-xs text-zinc-500">{t.detail.priorityLabel}</span>
            <select
              value={priorityId}
              onChange={(e) => setPriorityId(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {meta.priority.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {meta.severity && (
          <div className="grid grid-cols-[130px_1fr] items-center gap-2">
            <span className="text-xs text-zinc-500">{meta.severity.name}</span>
            <select
              value={severityId}
              onChange={(e) => setSeverityId(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {severityId === '' && (
                <option value="" disabled>
                  {t.detail.severityPlaceholder}
                </option>
              )}
              {meta.severity.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
        )}
        {meta.timeTrackingEditable && (
          <div className="grid grid-cols-[130px_1fr] items-center gap-2">
            <span className="text-xs text-zinc-500">{t.detail.originalEstimateLabel}</span>
            <input
              type="text"
              placeholder={t.detail.originalEstimatePlaceholder}
              value={originalEstimate}
              onChange={(e) => setOriginalEstimate(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button
            disabled={!dirty || saveBusy}
            title={!dirty ? t.detail.nothingChanged : undefined}
            onClick={() => void handleSave()}
          >
            {saveBusy ? (
              <Spinner />
            ) : saved ? (
              <CheckCircle2 size={14} className="text-green-400" />
            ) : null}
            {saveBusy ? t.detail.saving : t.detail.save}
          </Button>
        </div>
        {saveError && <p className="text-sm text-amber-400">{saveError}</p>}
      </div>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-500">
          {t.detail.timeSpentRegistered(registered)}
          {meta.originalEstimate && ` · ${t.detail.timeSpentEstimated(meta.originalEstimate)}`}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={t.detail.timeSpentPlaceholder}
            value={timeSpentInput}
            onChange={(e) => setTimeSpentInput(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <Button
            variant="secondary"
            disabled={!timeSpentInput.trim() || logBusy}
            onClick={() => void handleLogWork()}
          >
            {logBusy ? (
              <Spinner />
            ) : logSaved ? (
              <CheckCircle2 size={14} className="text-green-400" />
            ) : null}
            {logBusy ? t.detail.logging : t.detail.logWork}
          </Button>
        </div>
        <p className="text-xs text-zinc-600">{t.detail.timeSpentHint}</p>
        {logError && <p className="text-sm text-amber-400">{logError}</p>}
      </div>

      <div className="border-t border-zinc-800 pt-2">
        <WorklogsAccordion
          issueKey={issueKey}
          open={worklogsOpen}
          onToggle={() => setWorklogsOpen((v) => !v)}
          onTotalChanged={setRegistered}
        />
      </div>
    </div>
  )
}

/** Mini-form inline para criar uma subtarefa a partir do card aberto. */
function SubtaskCreateForm({
  issue,
  issueKey,
  subtaskType,
  onCreated,
  onCancel
}: {
  issue: Issue
  issueKey: string
  subtaskType: CreateIssueType
  onCreated: (key: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [assignToMe, setAssignToMe] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (): Promise<void> => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await invoke('issues:create', {
        projectKey: issue.projectKey,
        issueTypeId: subtaskType.id,
        summary: title.trim(),
        description: '',
        assignToMe,
        parentKey: issue.key
      })
      setTitle('')
      void queryClient.invalidateQueries({ queryKey: ['issue-children', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['issues'] })
      void invoke('sync:run', { full: false })
      onCreated(res.key)
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
      <Input
        placeholder={t.detail.subtaskTitlePlaceholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <label className="flex items-center gap-1.5 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={assignToMe}
          onChange={(e) => setAssignToMe(e.target.checked)}
          className="accent-indigo-600"
        />
        {t.create.assignToMe}
      </label>
      <div className="flex items-center gap-2">
        <Button disabled={busy || !title.trim()} onClick={() => void handleSubmit()}>
          {busy ? <Spinner /> : null}
          {busy ? t.detail.subtaskCreating : t.detail.subtaskCreate}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t.common.cancel}
        </Button>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
    </div>
  )
}

/**
 * Um comentário ao vivo. Se for do usuário atual, mostra ações discretas de
 * editar/excluir no header; edição troca o corpo por um textarea prefilled com o
 * texto plano; exclusão pede confirmação inline (sem window.confirm), que expira
 * sozinha em 5s.
 */
function CommentItem({
  comment,
  issueKey,
  myAccountId,
  mediaResolver
}: {
  comment: IpcResponse<'issues:comments'>['comments'][number]
  issueKey: string
  myAccountId: string | null
  mediaResolver: ReturnType<typeof useMediaResolver>
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const isMine = myAccountId !== null && comment.authorAccountId === myAccountId

  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view')
  const [body, setBody] = useState(comment.bodyText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'confirmDelete') return
    const timer = setTimeout(() => setMode('view'), 5000)
    return () => clearTimeout(timer)
  }, [mode])

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['issue-comments', issueKey] })
  }

  const handleSave = async (): Promise<void> => {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:commentUpdate', {
        issueKey,
        commentId: comment.id,
        body: body.trim()
      })
      invalidate()
      setMode('view')
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:commentDelete', { issueKey, commentId: comment.id })
      invalidate()
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
      setMode('view')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-300">{comment.authorName ?? 'Alguém'}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-zinc-600">
            {format(new Date(comment.createdAt), 'dd/MM/yyyy HH:mm')}
          </span>
          {isMine && mode === 'view' && (
            <div className="flex items-center gap-1">
              <button
                className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
                title={t.detail.editComment}
                aria-label={t.detail.editComment}
                onClick={() => {
                  setBody(comment.bodyText)
                  setMode('edit')
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
                title={t.detail.deleteComment}
                aria-label={t.detail.deleteComment}
                onClick={() => setMode('confirmDelete')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
          {isMine && mode === 'confirmDelete' && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-zinc-500">{t.detail.deleteConfirm}</span>
              <button
                className="font-medium text-red-400 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? <Spinner className="text-red-400" /> : t.detail.yes}
              </button>
              <button
                className="text-zinc-500 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => setMode('view')}
              >
                {t.detail.no}
              </button>
            </div>
          )}
        </div>
      </div>
      {mode === 'edit' ? (
        <div className="space-y-1.5">
          <textarea
            className="h-20 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-zinc-600">{t.detail.commentEditHint}</p>
          <div className="flex items-center gap-2">
            <Button disabled={busy || !body.trim()} onClick={() => void handleSave()}>
              {busy ? <Spinner /> : null}
              {busy ? t.detail.saving : t.common.save}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('view')}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <AdfView doc={comment.body} mediaResolver={mediaResolver} />
      )}
      {error && <p className="mt-1 text-sm text-amber-400">{error}</p>}
    </div>
  )
}

/**
 * Seção "Descrição": cabeçalho fixo + botão "Editar" (leitura -> textarea
 * markdown). Modo leitura delega pro ADF ao vivo (quando disponível) ou pro
 * texto local (fallback offline); sem nenhum dos dois, oferece "Editar" para
 * criar a descrição do zero.
 */
function DescriptionSection({
  issue,
  issueKey,
  liveDescription,
  mediaResolver,
  descExpanded,
  onExpand
}: {
  issue: Issue
  issueKey: string
  liveDescription: unknown | null
  mediaResolver: ReturnType<typeof useMediaResolver>
  descExpanded: boolean
  onExpand: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.descriptionText ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (): void => {
    setValue(issue.descriptionText ?? '')
    setError(null)
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:updateText', { key: issueKey, descriptionMarkdown: value })
      void queryClient.invalidateQueries({ queryKey: ['issue-description', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['issue', issueKey] })
      setEditing(false)
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <section>
        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {t.detail.description}
        </h3>
        <p className="mb-1.5 text-xs text-zinc-600">
          Editar substitui a formatação atual — o texto será salvo como markdown (títulos #, listas
          -, **negrito**, `código`).
        </p>
        <textarea
          className="min-h-40 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : null}
            {busy ? t.detail.saving : t.detail.save}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        </div>
        {error && <p className="mt-1 text-sm text-amber-400">{error}</p>}
      </section>
    )
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {t.detail.description}
        </h3>
        <button className="text-xs text-indigo-400 hover:underline" onClick={startEdit}>
          Editar
        </button>
      </div>
      {liveDescription ? (
        <AdfDescriptionBody
          doc={liveDescription}
          mediaResolver={mediaResolver}
          expanded={descExpanded}
          onExpand={onExpand}
        />
      ) : issue.descriptionText ? (
        <DescriptionBody text={issue.descriptionText} expanded={descExpanded} onExpand={onExpand} />
      ) : (
        <p className="text-sm text-zinc-500">Sem descrição.</p>
      )}
    </section>
  )
}

function AdfDescriptionBody({
  doc,
  mediaResolver,
  expanded,
  onExpand
}: {
  doc: unknown
  mediaResolver: ReturnType<typeof useMediaResolver>
  expanded: boolean
  onExpand: () => void
}): React.JSX.Element {
  // heurística barata de "descrição longa" sem medir o DOM
  const isLong = JSON.stringify(doc).length > 2500
  const collapsed = isLong && !expanded
  return (
    <div>
      <div className={collapsed ? 'relative max-h-96 overflow-hidden' : undefined}>
        <AdfView doc={doc} mediaResolver={mediaResolver} />
        {collapsed && (
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent" />
        )}
      </div>
      {collapsed && (
        <button className="mt-1 text-xs text-indigo-400 hover:underline" onClick={onExpand}>
          {t.detail.showAll}
        </button>
      )}
    </div>
  )
}

function DescriptionBody({
  text,
  expanded,
  onExpand
}: {
  text: string
  expanded: boolean
  onExpand: () => void
}): React.JSX.Element {
  const lines = text.split('\n')
  const truncated = !expanded && lines.length > DESCRIPTION_LINE_LIMIT
  const shown = truncated ? lines.slice(0, DESCRIPTION_LINE_LIMIT).join('\n') : text
  return (
    <div>
      <p className="rounded-md bg-zinc-900/60 p-3 text-sm whitespace-pre-wrap text-zinc-300">
        {shown}
        {truncated && '…'}
      </p>
      {truncated && (
        <button className="mt-1 text-xs text-indigo-400 hover:text-indigo-300" onClick={onExpand}>
          {t.detail.showAll}
        </button>
      )}
    </div>
  )
}

function ActivityLine({ activity }: { activity: IssueActivity }): React.JSX.Element {
  const meta = kindMeta[activity.kind]
  const Icon = meta.icon
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <Icon size={14} className={`mt-0.5 shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-medium text-zinc-300">{activity.actorName ?? '?'}</span>
          <span className="text-zinc-400">{meta.label}</span>
          {activity.kind === 'status_change' && (
            <span className="text-zinc-400">
              {activity.fromValue} → <span className="text-zinc-200">{activity.toValue}</span>
            </span>
          )}
          {activity.kind === 'assignment' && (
            <span className="text-zinc-400">para {activity.toValue ?? 'ninguém'}</span>
          )}
          {(activity.kind === 'priority_change' || activity.kind === 'estimate_change') && (
            <span className="text-zinc-400">
              {activity.fromValue ?? '—'} → {activity.toValue ?? '—'}
            </span>
          )}
        </div>
        {activity.kind === 'comment' && activity.bodyText && (
          <div className="mt-1 line-clamp-2 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
            {activity.bodyText}
          </div>
        )}
      </div>
      <span className="shrink-0 text-xs text-zinc-600">
        {format(new Date(activity.occurredAt), 'HH:mm dd/MM')}
      </span>
    </div>
  )
}

interface StatusSegment {
  status: string
  durationMs: number
}

/** Reconstrói quanto tempo o card passou em cada status a partir das activities de status_change. */
function buildStatusSegments(issue: Issue, activities: IssueActivity[]): StatusSegment[] {
  const changes = activities
    .filter((a) => a.kind === 'status_change')
    .slice()
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())

  if (changes.length === 0) return []

  const totals = new Map<string, number>()
  const addSegment = (status: string | null, startIso: string | null, endIso: string): void => {
    if (!status || !startIso) return
    const start = new Date(startIso).getTime()
    const end = new Date(endIso).getTime()
    if (end <= start) return
    totals.set(status, (totals.get(status) ?? 0) + (end - start))
  }

  addSegment(changes[0].fromValue, issue.createdAt, changes[0].occurredAt)
  for (let i = 1; i < changes.length; i++) {
    addSegment(changes[i - 1].toValue, changes[i - 1].occurredAt, changes[i].occurredAt)
  }
  const last = changes[changes.length - 1]
  addSegment(last.toValue, last.occurredAt, issue.resolvedAt ?? new Date().toISOString())

  return [...totals.entries()]
    .map(([status, durationMs]) => ({ status, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs)
}

function formatDays(ms: number): string {
  const days = ms / 86_400_000
  return `${days.toFixed(1).replace('.', ',')}d`
}

/**
 * Timer de trabalho do header. Parado sem tempo → só o Play; rodando → tempo +
 * Pause; pausado com tempo → tempo + Play (retomar) + Registrar (loga no Jira
 * e reseta) + X (descarta, com confirmação). Compacto para caber na primeira
 * linha do header ao lado dos demais botões.
 */
function TimerControl({
  issueKey,
  onError
}: {
  issueKey: string
  onError: (message: string | null) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const timer = useIssueTimer(issueKey)
  const [busy, setBusy] = useState(false)

  const handleLog = async (): Promise<void> => {
    setBusy(true)
    onError(null)
    try {
      await invoke('issues:logWork', {
        key: issueKey,
        timeSpent: formatJiraDuration(timer.seconds),
        comment: 'Registrado pelo timer do Jiraiya'
      })
      timer.reset()
      void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['worklogs', issueKey] })
    } catch (err) {
      onError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  const handleDiscard = (): void => {
    if (!window.confirm('Descartar o tempo acumulado no timer?')) return
    timer.reset()
  }

  if (!timer.hasTime) {
    return (
      <button
        className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        onClick={timer.start}
        title="Iniciar timer"
        aria-label="Iniciar timer"
      >
        <Play size={15} />
      </button>
    )
  }

  if (timer.running) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="font-mono text-xs tabular-nums text-zinc-300">
          {formatTimer(timer.seconds)}
        </span>
        <button
          className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={timer.pause}
          title="Pausar timer"
          aria-label="Pausar timer"
        >
          <Pause size={15} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <span className="font-mono text-xs tabular-nums text-zinc-400">
        {formatTimer(timer.seconds)}
      </span>
      <button
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        onClick={timer.start}
        title="Retomar timer"
        aria-label="Retomar timer"
      >
        <Play size={15} />
      </button>
      <button
        className="rounded-md p-1 text-xs font-medium text-indigo-400 hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={() => void handleLog()}
      >
        {busy ? <Spinner /> : 'Registrar'}
      </button>
      <button
        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        onClick={handleDiscard}
        title="Descartar tempo do timer"
        aria-label="Descartar tempo do timer"
      >
        <X size={13} />
      </button>
    </div>
  )
}

/**
 * Título editável: lápis aparece só no hover; clique troca pelo input inline
 * (Enter salva, Esc cancela, botões ✓/✗ fazem o mesmo). Invalida as mesmas
 * queries que as demais edições do card.
 */
function EditableTitle({ issue, issueKey }: { issue: Issue; issueKey: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.summary)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (): void => {
    setValue(issue.summary)
    setError(null)
    setEditing(true)
  }

  const cancel = (): void => {
    setEditing(false)
    setError(null)
  }

  const save = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === issue.summary) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:updateText', { key: issueKey, summary: trimmed })
      void queryClient.invalidateQueries({ queryKey: ['issue', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['board'] })
      void queryClient.invalidateQueries({ queryKey: ['issues'] })
      void queryClient.invalidateQueries({ queryKey: ['issue-activity', issueKey] })
      setEditing(false)
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-lg font-semibold text-zinc-100 outline-none focus:border-indigo-500"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') cancel()
            }}
          />
          <button
            className="shrink-0 rounded-md p-1 text-green-400 hover:bg-zinc-800 disabled:opacity-50"
            disabled={busy || !value.trim()}
            onClick={() => void save()}
            aria-label="Salvar título"
          >
            {busy ? <Spinner /> : <CheckCircle2 size={16} />}
          </button>
          <button
            className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 disabled:opacity-50"
            disabled={busy}
            onClick={cancel}
            aria-label="Cancelar edição do título"
          >
            <X size={16} />
          </button>
        </div>
        {error && <p className="text-sm text-amber-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-1.5">
      <h2 className="text-lg font-semibold text-zinc-100">{issue.summary}</h2>
      <button
        className="mt-1 shrink-0 rounded p-0.5 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-zinc-300 group-hover:opacity-100"
        onClick={startEdit}
        title="Editar título"
        aria-label="Editar título"
      >
        <Pencil size={14} />
      </button>
    </div>
  )
}

/**
 * Accordion "Lançamentos": fechado por padrão, só busca `useWorklogs` ao
 * abrir. `onTotalChanged` propaga o novo total pro "Registrado: X" do painel
 * de edição depois de editar/apagar um lançamento.
 */
function WorklogsAccordion({
  issueKey,
  open,
  onToggle,
  onTotalChanged
}: {
  issueKey: string
  open: boolean
  onToggle: () => void
  onTotalChanged: (total: string | null) => void
}): React.JSX.Element {
  const { data, isLoading } = useWorklogs(issueKey, open)
  const total = data?.totalTimeSpent ?? null

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-300"
        onClick={onToggle}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Lançamentos
        {total && <span className="normal-case text-zinc-600">({total})</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {isLoading ? (
            <Spinner className="text-zinc-500" />
          ) : !data || data.worklogs.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhum lançamento ainda.</p>
          ) : (
            data.worklogs.map((w) => (
              <WorklogItem
                key={w.id}
                worklog={w}
                issueKey={issueKey}
                onTotalChanged={onTotalChanged}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function WorklogItem({
  worklog,
  issueKey,
  onTotalChanged
}: {
  worklog: IpcResponse<'worklog:list'>['worklogs'][number]
  issueKey: string
  onTotalChanged: (total: string | null) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view')
  const [timeSpent, setTimeSpent] = useState(worklog.timeSpent)
  const [commentValue, setCommentValue] = useState(worklog.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'confirmDelete') return
    const timer = setTimeout(() => setMode('view'), 5000)
    return () => clearTimeout(timer)
  }, [mode])

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['worklogs', issueKey] })
    void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
  }

  const handleSave = async (): Promise<void> => {
    if (!timeSpent.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await invoke('worklog:update', {
        key: issueKey,
        worklogId: worklog.id,
        timeSpent: timeSpent.trim(),
        comment: commentValue.trim() || undefined
      })
      onTotalChanged(res.totalTimeSpent)
      invalidate()
      setMode('view')
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await invoke('worklog:delete', { key: issueKey, worklogId: worklog.id })
      onTotalChanged(res.totalTimeSpent)
      invalidate()
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
      setMode('view')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-zinc-300">{worklog.authorName ?? 'Alguém'}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-zinc-600">
            {format(new Date(worklog.started), 'dd/MM/yyyy HH:mm')}
          </span>
          {worklog.isMine && mode === 'view' && (
            <div className="flex items-center gap-1">
              <button
                className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
                title="Editar lançamento"
                aria-label="Editar lançamento"
                onClick={() => {
                  setTimeSpent(worklog.timeSpent)
                  setCommentValue(worklog.comment ?? '')
                  setMode('edit')
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="rounded p-0.5 text-zinc-600 hover:text-zinc-300"
                title="Apagar lançamento"
                aria-label="Apagar lançamento"
                onClick={() => setMode('confirmDelete')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
          {worklog.isMine && mode === 'confirmDelete' && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-zinc-500">{t.detail.deleteConfirm}</span>
              <button
                className="font-medium text-red-400 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? <Spinner className="text-red-400" /> : t.detail.yes}
              </button>
              <button
                className="text-zinc-500 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => setMode('view')}
              >
                {t.detail.no}
              </button>
            </div>
          )}
        </div>
      </div>
      {mode === 'edit' ? (
        <div className="mt-1.5 space-y-1.5">
          <input
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            placeholder="1h 30m"
            value={timeSpent}
            onChange={(e) => setTimeSpent(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            placeholder="Comentário (opcional)"
            value={commentValue}
            onChange={(e) => setCommentValue(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button disabled={busy || !timeSpent.trim()} onClick={() => void handleSave()}>
              {busy ? <Spinner /> : null}
              {busy ? t.detail.saving : t.common.save}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setMode('view')}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-zinc-300">{worklog.timeSpent}</p>
          {worklog.comment && <p className="mt-0.5 text-xs text-zinc-500">{worklog.comment}</p>}
        </>
      )}
      {error && <p className="mt-1 text-sm text-amber-400">{error}</p>}
    </div>
  )
}

/**
 * Mini-form "+ Vincular": tipo+direção (cada tipo do Jira vira duas opções,
 * outward/inward) + busca do card alvo (até 8 resultados) + botão Vincular.
 */
function LinkCreateForm({
  issueKey,
  onClose
}: {
  issueKey: string
  onClose: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: linkTypesData } = useLinkTypes(true)
  const [typeValue, setTypeValue] = useState('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<{ key: string; summary: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: searchData } = useIssueSearch(search)
  const results = (searchData?.issues ?? []).filter((i) => i.key !== issueKey).slice(0, 8)

  const typeOptions = (linkTypesData?.types ?? []).flatMap((type) => [
    { value: `${type.name}|outward`, label: type.outward },
    { value: `${type.name}|inward`, label: type.inward }
  ])

  const handleSubmit = async (): Promise<void> => {
    if (!typeValue || !target) return
    const separatorIndex = typeValue.lastIndexOf('|')
    const typeName = typeValue.slice(0, separatorIndex)
    const direction = typeValue.slice(separatorIndex + 1) as 'outward' | 'inward'
    setBusy(true)
    setError(null)
    try {
      await invoke('issues:linkCreate', {
        fromKey: issueKey,
        toKey: target.key,
        typeName,
        direction
      })
      void queryClient.invalidateQueries({ queryKey: ['issue-links', issueKey] })
      onClose()
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
      <select
        value={typeValue}
        onChange={(e) => setTypeValue(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
      >
        <option value="" disabled>
          Tipo de vínculo
        </option>
        {typeOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {target ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-950 px-2 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate text-zinc-300">
            {target.key} — {target.summary}
          </span>
          <button
            className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => setTarget(null)}
          >
            trocar
          </button>
        </div>
      ) : (
        <div>
          <Input
            placeholder="Buscar card por key ou título…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {results.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {results.map((r) => (
                <button
                  key={r.key}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  onClick={() => {
                    setTarget({ key: r.key, summary: r.summary })
                    setSearch('')
                  }}
                >
                  {r.key} — {r.summary}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button disabled={busy || !typeValue || !target} onClick={() => void handleSubmit()}>
          {busy ? <Spinner /> : null}
          {busy ? 'Vinculando…' : 'Vincular'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
      {error && <p className="text-sm text-amber-400">{error}</p>}
    </div>
  )
}

/** Badge com tons que o `Badge` de `./ui` não cobre (emerald/purple pros estados de PR). */
function MiniBadge({
  children,
  tone
}: {
  children: ReactNode
  tone: 'emerald' | 'purple' | 'zinc' | 'amber' | 'green' | 'red'
}): React.JSX.Element {
  const styles: Record<'emerald' | 'purple' | 'zinc' | 'amber' | 'green' | 'red', string> = {
    emerald: 'bg-emerald-900/50 text-emerald-300',
    purple: 'bg-purple-900/50 text-purple-300',
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-900/50 text-amber-300',
    green: 'bg-green-900/50 text-green-300',
    red: 'bg-red-900/50 text-red-300'
  }
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * Seção "Pull requests" — opcional e silenciosa: some por completo se a
 * integração estiver desligada, o `gh` não estiver disponível, ou não houver
 * PRs para o card (não é erro, é estado normal pra maioria dos cards).
 */
function PullRequestsSection({ issueKey }: { issueKey: string }): React.JSX.Element | null {
  const { data: prStatus } = usePrStatus()
  const enabled = !!prStatus?.enabled && !!prStatus?.ghAvailable
  const { data: prsData } = usePrsForIssue(issueKey, enabled)

  if (!enabled || !prsData || prsData.available === false || prsData.prs.length === 0) {
    return null
  }

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Pull requests
      </h3>
      <div className="space-y-1.5">
        {prsData.prs.map((pr) => (
          <PullRequestRow key={`${pr.repo}#${pr.number}`} pr={pr} />
        ))}
      </div>
    </section>
  )
}

function PullRequestRow({
  pr
}: {
  pr: IpcResponse<'prs:forIssue'>['prs'][number]
}): React.JSX.Element {
  const stateMeta =
    pr.state === 'open'
      ? { label: 'aberto', tone: 'emerald' as const }
      : pr.state === 'merged'
        ? { label: 'merged', tone: 'purple' as const }
        : { label: 'fechado', tone: 'zinc' as const }

  const reviewMeta =
    pr.reviewDecision === 'APPROVED'
      ? { label: 'aprovado', tone: 'green' as const }
      : pr.reviewDecision === 'CHANGES_REQUESTED'
        ? { label: 'mudanças', tone: 'amber' as const }
        : pr.reviewDecision === 'REVIEW_REQUIRED'
          ? { label: 'aguarda review', tone: 'zinc' as const }
          : null

  const checksMeta =
    pr.checks === 'passing'
      ? { label: '✓', tone: 'green' as const }
      : pr.checks === 'failing'
        ? { label: '✗', tone: 'red' as const }
        : pr.checks === 'pending'
          ? { label: '●', tone: 'amber' as const }
          : null

  return (
    <button
      className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-left text-sm hover:bg-zinc-900"
      onClick={() => window.open(pr.url, '_blank')}
    >
      <span className="min-w-0 flex-1 truncate text-zinc-300">
        <span className="text-zinc-500">
          {pr.repo}#{pr.number}
        </span>{' '}
        {pr.title}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <MiniBadge tone={stateMeta.tone}>{stateMeta.label}</MiniBadge>
        {pr.isDraft && <MiniBadge tone="zinc">draft</MiniBadge>}
        {reviewMeta && <MiniBadge tone={reviewMeta.tone}>{reviewMeta.label}</MiniBadge>}
        {checksMeta && <MiniBadge tone={checksMeta.tone}>{checksMeta.label}</MiniBadge>}
      </div>
    </button>
  )
}
