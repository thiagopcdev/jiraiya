import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flag,
  MessageSquare,
  Plus,
  Ruler,
  Sparkles,
  UserRound,
  X,
  Zap
} from 'lucide-react'
import type { ActivityKind, Issue, IssueActivity } from '@shared/domain'
import { invoke, IpcError } from '../api/client'
import { useIssueActivity, useSprintList } from '../api/hooks'
import { Badge, Button, EmptyState, Spinner } from './ui'
import { AdfView } from './AdfView'
import { statusColor } from './statusColor'
import { IssueDetailContext } from './issueDetail'
import { t } from '../strings/ptBR'

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

export function IssueDetailProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    if (!openKey) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenKey(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openKey])

  return (
    <IssueDetailContext.Provider value={{ openIssue: setOpenKey, close: () => setOpenKey(null) }}>
      {children}
      {openKey && <IssueDetailDrawer issueKey={openKey} onClose={() => setOpenKey(null)} />}
    </IssueDetailContext.Provider>
  )
}

function IssueDetailDrawer({
  issueKey,
  onClose
}: {
  issueKey: string
  onClose: () => void
}): React.JSX.Element {
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
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="font-mono text-sm text-zinc-400">{issueKey}</span>
          {issue?.statusCategory && (
            <Badge color={statusColor(issue.statusCategory)}>{issue.status}</Badge>
          )}
          {issue?.issueType && <Badge color="zinc">{issue.issueType}</Badge>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={openInJira}>
            <ExternalLink size={14} />
            {t.detail.openInJira}
          </Button>
          <button
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            aria-label={t.detail.close}
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
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
                <h2 className="text-lg font-semibold text-zinc-100">{issue.summary}</h2>
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

              {liveDescription?.description ? (
                <AdfDescription
                  doc={liveDescription.description}
                  expanded={descExpanded}
                  onExpand={() => setDescExpanded(true)}
                />
              ) : issue.descriptionText ? (
                <DescriptionBlock
                  text={issue.descriptionText}
                  expanded={descExpanded}
                  onExpand={() => setDescExpanded(true)}
                />
              ) : null}

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
                        <div
                          key={c.id}
                          className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5"
                        >
                          <div className="mb-1.5 flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium text-zinc-300">
                              {c.authorName ?? 'Alguém'}
                            </span>
                            <span className="shrink-0 text-xs text-zinc-600">
                              {format(new Date(c.createdAt), 'dd/MM/yyyy HH:mm')}
                            </span>
                          </div>
                          <AdfView doc={c.body} />
                        </div>
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

/** Descrição em ADF formatado; colapsa (com fade) apenas quando o conteúdo é longo. */
function AdfDescription({
  doc,
  expanded,
  onExpand
}: {
  doc: unknown
  expanded: boolean
  onExpand: () => void
}): React.JSX.Element {
  // heurística barata de "descrição longa" sem medir o DOM
  const isLong = JSON.stringify(doc).length > 2500
  const collapsed = isLong && !expanded
  return (
    <section>
      <div className={collapsed ? 'relative max-h-96 overflow-hidden' : undefined}>
        <AdfView doc={doc} />
        {collapsed && (
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-950 to-transparent" />
        )}
      </div>
      {collapsed && (
        <button className="mt-1 text-xs text-indigo-400 hover:underline" onClick={onExpand}>
          {t.detail.showAll}
        </button>
      )}
    </section>
  )
}

function DescriptionBlock({
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
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {t.detail.description}
      </h3>
      <p className="rounded-md bg-zinc-900/60 p-3 text-sm whitespace-pre-wrap text-zinc-300">
        {shown}
        {truncated && '…'}
      </p>
      {truncated && (
        <button className="mt-1 text-xs text-indigo-400 hover:text-indigo-300" onClick={onExpand}>
          {t.detail.showAll}
        </button>
      )}
    </section>
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
