import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Link2,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Flag,
  GitBranch,
  LibraryBig,
  Lock,
  MessageSquare,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Ruler,
  Sparkles,
  Trash2,
  UserRound,
  UserRoundPen,
  X,
  Zap
} from 'lucide-react'
import type {
  ActivityKind,
  ChangelogEntry,
  CreateIssueType,
  Issue,
  IssueActivity
} from '@shared/domain'
import type { IpcRequest, IpcResponse } from '@shared/ipc-contract'
import { invoke, IpcError } from '../api/client'
import {
  useAiStatus,
  useAuthStatus,
  useIssueActivity,
  useIssueSearch,
  useIssueTypes,
  useLinkTypes,
  useMoveTargets,
  usePrsForIssue,
  usePrStatus,
  useSprintList,
  unavailableAiProviderLabel,
  useWorklogs
} from '../api/hooks'
import { Badge, Button, EmptyState, Input, Spinner } from './ui'
import { AdfView } from './AdfView'
import { MarkdownLite } from './MarkdownLite'
import { MarkdownToolbar } from './MarkdownToolbar'
import { AttachmentsSection, useMediaResolver } from './attachments'
import { statusColor } from './statusColor'
import {
  clampDetailPanelWidth,
  DETAIL_DOCK_MIN_WINDOW_QUERY,
  IssueDetailContext,
  loadDetailPanelWidth,
  saveDetailPanelWidth,
  useIssueDetail,
  type IssueDetailApi
} from './issueDetail'
import { t } from '../strings/ptBR'
import { formatJiraDuration, formatTimer, useIssueTimer } from '../lib/timer'
import { branchName } from '../lib/branchName'
import { compactAgo } from '../lib/relativeTime'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import { useQueue } from '../lib/queue'

/** Converte um File em base64 puro (sem o prefixo `data:...;base64,`). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => {
      const result = reader.result as string
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = (): void => reject(reader.error ?? new Error('Falha ao ler o arquivo'))
    reader.readAsDataURL(file)
  })
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const kindMeta: Record<ActivityKind, { icon: typeof Zap; label: string; color: string }> = {
  created: { icon: Plus, label: 'criou', color: 'text-zinc-400' },
  status_change: {
    icon: ArrowRightLeft,
    label: 'moveu',
    color: 'text-blue-400 light:text-blue-600'
  },
  resolved: {
    icon: CheckCircle2,
    label: 'resolveu',
    color: 'text-green-400 light:text-green-600'
  },
  assignment: {
    icon: UserRound,
    label: 'atribuiu',
    color: 'text-amber-400 light:text-amber-600'
  },
  comment: {
    icon: MessageSquare,
    label: 'comentou',
    color: 'text-indigo-400 light:text-indigo-600'
  },
  sprint_change: {
    icon: Zap,
    label: 'mudou sprint',
    color: 'text-purple-400 light:text-purple-600'
  },
  priority_change: {
    icon: Flag,
    label: 'mudou prioridade',
    color: 'text-red-400 light:text-red-600'
  },
  estimate_change: { icon: Ruler, label: 'estimou', color: 'text-teal-400 light:text-teal-600' }
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

/** Par de abas "Editar | Prévia" usado nos editores de descrição e comentário. */
function EditPreviewTabs({
  mode,
  onChange
}: {
  mode: 'edit' | 'preview'
  onChange: (mode: 'edit' | 'preview') => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 text-xs">
      <button
        type="button"
        className={`rounded px-2 py-0.5 ${
          mode === 'edit' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
        }`}
        onClick={() => onChange('edit')}
      >
        Editar
      </button>
      <button
        type="button"
        className={`rounded px-2 py-0.5 ${
          mode === 'preview' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
        }`}
        onClick={() => onChange('preview')}
      >
        Prévia
      </button>
    </div>
  )
}

/**
 * Fiação entre o provider e os hosts docados. Fica FORA do `IssueDetailApi`
 * público: quem consome o contexto só precisa de `<DockedPanel />`; o resto
 * (pilha, contador de hosts, faixa de largura) é detalhe interno.
 */
interface IssueDetailDock {
  topKey: string | null
  onBack: (() => void) | null
  close: () => void
  /** Registra um host docado; a função devolvida desregistra (use no cleanup). */
  registerHost: () => () => void
  /** false abaixo de 1100px de janela — o docado deixa de valer (handoff regra 2) */
  dockAllowed: boolean
}

const IssueDetailDockContext = createContext<IssueDetailDock>({
  topKey: null,
  onBack: null,
  close: () => {},
  registerHost: () => () => {},
  dockAllowed: false
})

/**
 * Chave do card aberto agora (topo da pilha), para a tela de fundo marcar a
 * linha/cartão correspondente como selecionado. Só leitura: não entra no
 * `IssueDetailApi` porque não é ação, e fora do provider devolve null (o
 * contexto tem default próprio).
 */
// hook exportado ao lado de componentes — Fast Refresh reclama, mas o estado
// mora no contexto interno deste arquivo.
// eslint-disable-next-line react-refresh/only-export-components
export function useOpenIssueKey(): string | null {
  return useContext(IssueDetailDockContext).topKey
}

function matchesDockWidth(): boolean {
  return window.matchMedia(DETAIL_DOCK_MIN_WINDOW_QUERY).matches
}

/**
 * Acompanha `(min-width: 1100px)`. Escutamos `resize` E o `change` do
 * matchMedia: o segundo é o sinal certo, mas em janela redimensionada aos
 * poucos o primeiro chega antes — e reavaliar a query é barato.
 */
function useDockAllowed(): boolean {
  const [allowed, setAllowed] = useState(matchesDockWidth)
  useEffect(() => {
    const update = (): void => setAllowed(matchesDockWidth())
    update()
    const mql = window.matchMedia(DETAIL_DOCK_MIN_WINDOW_QUERY)
    window.addEventListener('resize', update)
    mql.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      mql.removeEventListener('change', update)
    }
  }, [])
  return allowed
}

export function IssueDetailProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // pilha de navegação interna do drawer: abrir um pai/subtarefa/vínculo empilha por
  // cima do card atual; "voltar" desempilha; fechar limpa tudo de uma vez.
  const [stack, setStack] = useState<string[]>([])

  const openIssue = useCallback((key: string): void => {
    setStack((prev) => {
      if (prev.length === 0) return [key]
      if (prev[prev.length - 1] === key) return prev
      return [...prev, key]
    })
  }, [])
  const close = useCallback((): void => setStack([]), [])
  const back = useCallback((): void => setStack((prev) => prev.slice(0, -1)), [])

  // contador — e não booleano — de hosts docados montados: numa troca de rota o
  // host novo pode montar antes de o antigo desmontar, e um booleano faria o
  // overlay piscar no meio da transição.
  const [dockedHosts, setDockedHosts] = useState(0)
  const registerHost = useCallback((): (() => void) => {
    setDockedHosts((n) => n + 1)
    return () => setDockedHosts((n) => n - 1)
  }, [])
  const dockAllowed = useDockAllowed()

  useEffect(() => {
    if (stack.length === 0) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : []))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stack.length])

  // notificação de card seguido (ex.: mudança de status) -> abre a gaveta direto
  useEffect(() => {
    const off = window.api.on('push:open-issue', ({ key }) => openIssue(key))
    return () => off()
  }, [openIssue])

  const topKey = stack[stack.length - 1] ?? null
  const onBack = stack.length > 1 ? back : null

  const api = useMemo<IssueDetailApi>(
    () => ({ openIssue, close, DockedPanel: IssueDetailDockedHost }),
    [openIssue, close]
  )
  const dock = useMemo<IssueDetailDock>(
    () => ({ topKey, onBack, close, registerHost, dockAllowed }),
    [topKey, onBack, close, registerHost, dockAllowed]
  )

  return (
    <IssueDetailContext.Provider value={api}>
      <IssueDetailDockContext.Provider value={dock}>
        {children}
        {topKey && dockedHosts === 0 && (
          <IssueDetailDrawer key={topKey} issueKey={topKey} onClose={close} onBack={onBack} />
        )}
      </IssueDetailDockContext.Provider>
    </IssueDetailContext.Provider>
  )
}

/**
 * O que o contexto expõe como `DockedPanel`. É uma referência de módulo (e não
 * um componente criado dentro do provider) porque uma identidade nova a cada
 * render remontaria o painel — e com ele todo o estado do card aberto.
 */
function IssueDetailDockedHost(): React.JSX.Element | null {
  const { topKey, onBack, close, registerHost, dockAllowed } = useContext(IssueDetailDockContext)

  // registra no efeito de montagem (não no render) para o provider poder
  // contar hosts sem set-state durante o render de outro componente
  useEffect(() => {
    if (!dockAllowed) return
    return registerHost()
  }, [dockAllowed, registerHost])

  if (!dockAllowed || !topKey) return null
  return <IssueDetailPanel key={topKey} issueKey={topKey} onClose={close} onBack={onBack} />
}

/**
 * Gaveta sobreposta — comportamento histórico: backdrop clicável, 560px
 * encostados na direita e entrada animada com translate-x.
 */
function IssueDetailDrawer({
  issueKey,
  onClose,
  onBack
}: {
  issueKey: string
  onClose: () => void
  onBack: (() => void) | null
}): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`absolute inset-y-0 right-0 flex h-full w-[560px] max-w-[90vw] flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <IssueDetailBody variant="overlay" issueKey={issueKey} onClose={onClose} onBack={onBack} />
      </div>
    </div>
  )
}

/**
 * Painel docado: in-flow (ocupa espaço em vez de cobrir a tela), sem backdrop,
 * sem sombra e sem animação de entrada. Divisor de 8px na borda esquerda —
 * como o painel encosta na direita, arrastar para a esquerda alarga.
 */
function IssueDetailPanel({
  issueKey,
  onClose,
  onBack
}: {
  issueKey: string
  onClose: () => void
  onBack: (() => void) | null
}): React.JSX.Element {
  const [width, setWidth] = useState(loadDetailPanelWidth)
  const widthRef = useRef(width)
  useEffect(() => {
    widthRef.current = width
  }, [width])

  // teardown do arrasto em andamento: sem isso, desmontar no meio do drag
  // (fechar o card, cair abaixo de 1100px) deixaria listeners no window
  const stopDragRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDragRef.current?.(), [])

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widthRef.current
    const onMove = (ev: PointerEvent): void => {
      setWidth(clampDetailPanelWidth(startWidth + (startX - ev.clientX)))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      stopDragRef.current = null
      saveDetailPanelWidth(widthRef.current)
    }
    stopDragRef.current = stop
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-shrink-0 flex-col border-l border-zinc-800 bg-zinc-900"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.detail.resizeHandle}
        title={t.detail.resizeHandle}
        className="absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize items-center justify-center"
        onPointerDown={startResize}
      >
        <span className="h-[26px] w-0.5 rounded-full bg-zinc-700" />
      </div>
      <IssueDetailBody variant="docked" issueKey={issueKey} onClose={onClose} onBack={onBack} />
    </div>
  )
}

type DetailVariant = 'overlay' | 'docked'

/** Abas da área de atividade do card (handoff B3). */
type DetailTab = 'comments' | 'history' | 'worklogs' | 'prs'

/**
 * Conteúdo do card — header de ações, corpo rolável e composer. Sem chrome:
 * quem posiciona é o `IssueDetailDrawer` (sobreposto) ou o `IssueDetailPanel`
 * (docado). `variant` muda só layout; o comportamento é idêntico nos dois.
 */
function IssueDetailBody({
  variant,
  issueKey,
  onClose,
  onBack
}: {
  variant: DetailVariant
  issueKey: string
  onClose: () => void
  onBack: (() => void) | null
}): React.JSX.Element {
  const docked = variant === 'docked'
  const { openIssue } = useIssueDetail()
  const queryClient = useQueryClient()

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

  // descrição ao vivo (ADF formatado + markdown); erro/carregando → fallback pro texto local
  const { data: liveDescription, isLoading: liveDescriptionLoading } = useQuery({
    queryKey: ['issue-description', issueKey],
    queryFn: () => invoke('issues:description', { key: issueKey }),
    staleTime: 30_000,
    retry: 0
  })

  // cards sincronizados antes da coluna reporter_name só têm o relator no
  // payload ao vivo; o valor local vem primeiro para não piscar offline
  const reporterName = issue?.reporterName ?? liveDescription?.reporterName ?? null

  const { data: aiStatus } = useAiStatus()
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
    const transition = transitionsData?.transitions.find((tr) => tr.id === transitionId)
    setMoveBusy(true)
    setMoveError(null)
    try {
      const res = await invoke('issues:transition', {
        key: issueKey,
        transitionId,
        toStatusName: transition?.toStatusName,
        toCategoryKey: transition?.toCategoryKey
      })
      invalidateAfterTransition()
      if (res.queued) {
        setMoveError(t.queue.queuedToast)
        setTimeout(() => setMoveError(null), 6000)
      } else {
        setMoveSuccess(true)
        setTimeout(() => setMoveSuccess(false), 3000)
      }
    } catch (err) {
      const message = err instanceof IpcError ? err.message : t.common.error
      setMoveError(message)
      setTimeout(() => setMoveError(null), 6000)
    } finally {
      setMoveBusy(false)
      setSelectedTransitionId('')
    }
  }

  // ações da fila offline pendentes especificamente para este card
  const { actions: queueActions } = useQueue()
  const pendingActionsOnIssue = queueActions.filter((a) => a.issueKey === issueKey)

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
  // o drawer inteiro remonta por issueKey (veja o `key={topKey}` no provider), então
  // este useState só roda uma vez por card — é o ponto certo pra restaurar o rascunho
  const [comment, setComment] = useState(() => loadDraft(issueKey) ?? '')
  const [draftRestored, setDraftRestored] = useState(() => loadDraft(issueKey) !== null)
  const [commentViewMode, setCommentViewMode] = useState<'edit' | 'preview'>('edit')
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [commentSent, setCommentSent] = useState(false)

  // salva o rascunho do comentário em edição com debounce — não é set-state síncrono,
  // só grava no localStorage após o usuário parar de digitar por ~500ms
  useEffect(() => {
    const timer = window.setTimeout(() => saveDraft(issueKey, comment), 500)
    return () => window.clearTimeout(timer)
  }, [issueKey, comment])

  const discardDraft = (): void => {
    clearDraft(issueKey)
    setComment('')
    setDraftRestored(false)
  }

  const [aiOpen, setAiOpen] = useState(false)
  // timeline em accordion, fechada por padrão
  const [timelineOpen, setTimelineOpen] = useState(false)

  // PRs do card: a aba só existe quando a integração está ligada, o `gh`
  // responde e há PR para o card — a mesma condição que antes fazia a seção
  // inteira sumir (não é erro, é o estado normal da maioria dos cards)
  const { data: prStatus } = usePrStatus()
  const prEnabled = !!prStatus?.enabled && !!prStatus?.ghAvailable
  const { data: prsData } = usePrsForIssue(issueKey, prEnabled)
  const prs = prsData && prsData.available !== false ? prsData.prs : []
  const showPrsTab = prEnabled && prs.length > 0

  // abas da área de atividade. `activeTab` é derivado (e não um efeito de
  // correção) porque a aba de PRs pode sumir depois de selecionada — se a
  // integração cair ou o último PR for fechado, cair de volta em Comentários
  // no mesmo render evita um quadro com aba nenhuma ativa.
  const [tab, setTab] = useState<DetailTab>('comments')
  const activeTab: DetailTab = tab === 'prs' && !showPrsTab ? 'comments' : tab

  // histórico (changelog): continua lazy — só busca quando a aba fica ativa
  const {
    data: changelogData,
    isLoading: changelogLoading,
    isError: changelogFailed
  } = useQuery({
    queryKey: ['issue-changelog', issueKey],
    queryFn: () => invoke('issues:changelog', { key: issueKey }),
    enabled: activeTab === 'history',
    retry: 0
  })
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

  const [branchCopied, setBranchCopied] = useState(false)
  const copyBranch = async (): Promise<void> => {
    if (!issue) return
    const text = branchName(issue.issueType ?? null, issueKey, issue.summary)
    await invoke('export:clipboard', { text })
    setBranchCopied(true)
    setTimeout(() => setBranchCopied(false), 2000)
  }

  // "Seguir card": notifica mudanças no card mesmo fora do escopo padrão de alertas
  const { data: watchData } = useQuery({
    queryKey: ['watch', issueKey],
    queryFn: () => invoke('watch:status', { key: issueKey }),
    enabled: !!issue
  })
  const watching = watchData?.watching ?? false
  const [watchBusy, setWatchBusy] = useState(false)
  const toggleWatch = async (): Promise<void> => {
    setWatchBusy(true)
    try {
      const res = await invoke('watch:toggle', { key: issueKey })
      queryClient.setQueryData(['watch', issueKey], res)
    } catch {
      // silencioso — o botão simplesmente não muda de estado
    } finally {
      setWatchBusy(false)
    }
  }

  const submitComment = async (): Promise<void> => {
    if (!comment.trim()) return
    setCommentBusy(true)
    setCommentError(null)
    try {
      const res = await invoke('issues:comment', { issueKey, body: comment.trim() })
      setComment('')
      clearDraft(issueKey)
      setDraftRestored(false)
      void invoke('sync:run', { full: false })
      void queryClient.invalidateQueries({ queryKey: ['issue-activity', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['issue-comments', issueKey] })
      if (res.queued) {
        setCommentError(t.queue.queuedToast)
      } else {
        setCommentSent(true)
        setTimeout(() => setCommentSent(false), 3000)
      }
    } catch (err) {
      setCommentError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setCommentBusy(false)
    }
  }

  // cola uma imagem no textarea de comentário -> sobe como anexo do card e
  // referencia o arquivo por nome no corpo do comentário em edição
  const handleCommentPaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    for (const file of images) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setCommentError(`Imagem muito grande (máx. 20MB): ${file.name}`)
        continue
      }
      try {
        const dataBase64 = await fileToBase64(file)
        await invoke('issues:attachmentUpload', { key: issueKey, filename: file.name, dataBase64 })
        void queryClient.invalidateQueries({ queryKey: ['issue-attachments', issueKey] })
        setComment((prev) => (prev ? `${prev}\n(anexo: ${file.name})` : `(anexo: ${file.name})`))
      } catch (err) {
        setCommentError(err instanceof IpcError ? err.message : t.common.error)
      }
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

  // no docado o select entra na própria linha do header (380px não comportam
  // uma segunda linha só para ele); na gaveta continua embaixo, como sempre
  const transitionControl =
    transitionsData && transitionsData.transitions.length > 0 ? (
      <>
        <select
          value={selectedTransitionId}
          disabled={moveBusy}
          title={moveBusy ? t.detail.moving : t.detail.moveTo}
          onChange={(e) => {
            setSelectedTransitionId(e.target.value)
            void handleTransitionChange(e.target.value)
          }}
          className={`rounded-md border border-zinc-700 bg-zinc-950/60 outline-none focus:border-indigo-500 disabled:opacity-50 ${
            // 380px não comportam o select em tamanho cheio ao lado do timer e
            // dos ícones — no docado ele encolhe de propósito
            docked
              ? 'min-w-0 flex-1 px-[7px] py-1 text-[11px] text-zinc-200'
              : 'max-w-72 px-1.5 py-1 text-xs text-zinc-300'
          }`}
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
            <CheckCircle2 size={14} className="text-green-400 light:text-green-600" />
          </span>
        )}
      </>
    ) : null

  // contagem ao lado do rótulo da aba (só quando há o que contar) — sem
  // parênteses, como no protótipo: "Comentários 4"
  const tabCount = (n: number): React.JSX.Element => (
    <span className="text-[12px] font-semibold text-zinc-500">{n}</span>
  )

  // rótulos das abas; a de PRs só entra na lista quando há PR para mostrar
  const tabs: Array<{ id: DetailTab; label: string; badge?: React.JSX.Element }> = [
    {
      id: 'comments',
      label: t.detail.tabComments,
      badge:
        liveComments && liveComments.comments.length > 0
          ? tabCount(liveComments.comments.length)
          : undefined
    },
    { id: 'history', label: t.detail.tabHistory },
    { id: 'worklogs', label: t.detail.tabWorklogs },
    ...(showPrsTab
      ? [{ id: 'prs' as const, label: t.detail.tabPrs, badge: tabCount(prs.length) }]
      : [])
  ]

  /**
   * Composer de comentário. Sai como variável (e não JSX inline) porque muda
   * de lugar conforme o variant: na gaveta rola junto com o corpo, como
   * sempre; no docado fica ancorado no rodapé, fora da área rolável. O
   * conteúdo e o comportamento são os mesmos nos dois — só a moldura muda.
   */
  const composer = (
    <section className={docked ? 'space-y-2' : 'space-y-2 border-t border-zinc-800 pt-4'}>
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {t.detail.commentTitle}
      </h3>
      {draftRestored && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-400">
          <span>{t.drafts.restored}</span>
          <button
            className="text-indigo-400 hover:underline light:text-indigo-600"
            onClick={discardDraft}
          >
            {t.drafts.discard}
          </button>
        </div>
      )}
      {aiOpen && (
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
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
          {aiError && <p className="text-sm text-amber-400 light:text-amber-600">{aiError}</p>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <EditPreviewTabs mode={commentViewMode} onChange={setCommentViewMode} />
        {commentViewMode === 'edit' && (
          <div className="flex items-center gap-1">
            <MarkdownToolbar
              textareaRef={commentRef}
              value={comment}
              onChange={setComment}
              aiContext="comment"
            />
            <TemplatesMenu textareaRef={commentRef} value={comment} onChange={setComment} />
          </div>
        )}
      </div>
      {commentViewMode === 'edit' ? (
        <textarea
          ref={commentRef}
          className="h-24 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          placeholder={t.detail.commentPlaceholder}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onPaste={(e) => void handleCommentPaste(e)}
        />
      ) : (
        <div className="h-24 w-full overflow-y-auto rounded-md border border-zinc-800 p-3">
          <MarkdownLite text={comment} />
        </div>
      )}
      <p className="-mt-1 text-xs text-zinc-600">
        Markdown: **negrito**, listas, `código` — cole imagem para anexar
      </p>
      <div className="flex items-center gap-2">
        <Button disabled={commentBusy || !comment.trim()} onClick={() => void submitComment()}>
          {commentBusy ? <Spinner /> : commentSent ? <CheckCircle2 size={14} /> : null}
          {commentBusy ? t.detail.commentSending : t.detail.commentSubmit}
        </Button>
        {!aiOpen && (
          <Button
            variant="secondary"
            disabled={!aiStatus?.active}
            title={
              !aiStatus?.active
                ? t.detail.aiUnavailableHint(unavailableAiProviderLabel(aiStatus))
                : undefined
            }
            onClick={() => setAiOpen(true)}
          >
            <Sparkles size={14} />
            {t.detail.aiStructure}
          </Button>
        )}
      </div>
      {commentError && (
        <p className="text-sm text-amber-400 light:text-amber-600">{commentError}</p>
      )}
      {!aiStatus?.active && (
        <p className="text-xs text-zinc-600">
          {t.detail.aiUnavailableHint(unavailableAiProviderLabel(aiStatus))}
        </p>
      )}
    </section>
  )

  // botões de ícone do cabeçalho: no docado o alvo encolhe um degrau para os
  // cinco caberem ao lado do select e do timer em 380px
  const headerIconButton = `shrink-0 rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${
    docked ? 'p-1' : 'p-1.5'
  }`

  return (
    <>
      <div className={`border-b border-zinc-800 ${docked ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
        <div className={`flex items-center ${docked ? 'gap-[7px]' : 'gap-2'}`}>
          {onBack && (
            <button
              className="shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={onBack}
              aria-label={t.detail.backLabel}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <span
            className={`shrink-0 font-mono whitespace-nowrap select-text ${
              docked ? 'text-xs font-bold text-indigo-400' : 'text-sm text-zinc-400'
            }`}
          >
            {issueKey}
          </span>
          {docked ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">{transitionControl}</div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {issue?.statusCategory && (
                <Badge color={statusColor(issue.statusCategory)}>{issue.status}</Badge>
              )}
              {issue?.issueType && <Badge color="zinc">{issue.issueType}</Badge>}
            </div>
          )}
          <TimerControl issueKey={issueKey} onError={setTimerError} />
          <button
            className={headerIconButton}
            onClick={() => void shareIssue()}
            title={shareCopied ? t.detail.shareCopied : t.detail.share}
            aria-label={t.detail.share}
          >
            {shareCopied ? (
              <CheckCircle2 size={15} className="text-green-400 light:text-green-600" />
            ) : (
              <Link2 size={15} />
            )}
          </button>
          {/* O handoff pedia tirar este ícone no docado de 380px por achar que
              era o atalho de PR — não é: é o "copiar nome do branch", e não há
              outro caminho para ele. Fica nos dois modos; quem cede largura é o
              <select> de status, reduzido logo abaixo. */}
          {issue && (
            <button
              className={headerIconButton}
              onClick={() => void copyBranch()}
              title={branchCopied ? 'Nome do branch copiado!' : 'Copiar nome do branch'}
              aria-label="Copiar nome do branch"
            >
              {branchCopied ? (
                <CheckCircle2 size={15} className="text-green-400 light:text-green-600" />
              ) : (
                <GitBranch size={15} />
              )}
            </button>
          )}
          <button
            className={`${headerIconButton} disabled:opacity-50`}
            onClick={() => void toggleWatch()}
            disabled={watchBusy}
            title={watching ? 'Deixar de seguir (notifica mudanças)' : 'Seguir (notifica mudanças)'}
            aria-label={watching ? 'Deixar de seguir' : 'Seguir card'}
          >
            {watching ? (
              <Eye size={15} className="text-indigo-400 light:text-indigo-600" />
            ) : (
              <EyeOff size={15} />
            )}
          </button>
          <button
            className={headerIconButton}
            onClick={openInJira}
            title={t.detail.openInJira}
            aria-label={t.detail.openInJira}
          >
            <ExternalLink size={15} />
          </button>
          <button className={headerIconButton} onClick={onClose} aria-label={t.detail.close}>
            <X size={16} />
          </button>
        </div>
        {!docked && transitionControl && (
          <div className="mt-2 flex items-center gap-1.5">{transitionControl}</div>
        )}
      </div>
      {moveError && (
        <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
          <p className="text-sm text-amber-400 light:text-amber-600">{moveError}</p>
        </div>
      )}
      {timerError && (
        <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
          <p className="text-sm text-amber-400 light:text-amber-600">{timerError}</p>
        </div>
      )}
      {pendingActionsOnIssue.length > 0 && (
        <div className="border-b border-amber-500/40 bg-amber-950/30 px-4 py-2 light:bg-amber-50">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-400 light:text-amber-700">
            <AlertTriangle size={12} />
            {t.queue.pendingOnIssue}
          </p>
          <div className="space-y-1">
            {pendingActionsOnIssue.map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-amber-200/90 light:text-amber-800">
                  {action.summary}
                </span>
                <span
                  className="shrink-0"
                  title={action.status === 'failed' ? (action.lastError ?? undefined) : undefined}
                >
                  <MiniBadge
                    tone={
                      action.status === 'failed'
                        ? 'red'
                        : action.status === 'inflight'
                          ? 'amber'
                          : 'zinc'
                    }
                  >
                    {action.status === 'failed'
                      ? t.queue.statusFailed
                      : action.status === 'inflight'
                        ? t.queue.statusInflight
                        : t.queue.statusPending}
                  </MiniBadge>
                </span>
              </div>
            ))}
          </div>
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
          <div className={docked ? 'space-y-4 p-3.5' : 'space-y-5 p-4'}>
            <div>
              <EditableTitle issue={issue} issueKey={issueKey} />
              <IssueMetaFields
                variant={variant}
                issue={issue}
                reporterName={reporterName}
                sprintName={sprintName}
              />
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
              liveMarkdown={liveDescription?.markdown ?? null}
              descriptionLoading={liveDescriptionLoading}
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
                      className="block text-left text-sm text-indigo-400 hover:underline light:text-indigo-600"
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
                            className="text-xs text-indigo-400 hover:underline light:text-indigo-600"
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
                              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-950/60"
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
                          className="text-xs text-indigo-400 hover:underline light:text-indigo-600"
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
                            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-950/60"
                            onClick={() => openIssue(link.key)}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {link.label}: {link.key} — {link.summary ?? ''}
                            </span>
                            {link.statusCategory && (
                              <Badge color={statusColor(link.statusCategory)}>{link.status}</Badge>
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

            <AttachmentsUploadSection issueKey={issueKey} />

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

            <section>
              {/* mesma aba sublinhada do PairTabs; overflow-x só entra em ação
                  se o painel for encolhido até o mínimo */}
              <div className="flex overflow-x-auto border-b border-zinc-800">
                {tabs.map((item) => {
                  const active = item.id === activeTab
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={`-mb-px flex shrink-0 cursor-pointer items-center gap-1 border-b-2 px-3.5 pt-2 pb-2.5 text-[13px] whitespace-nowrap transition-colors first:pl-0 ${
                        active
                          ? 'border-indigo-500 font-semibold text-indigo-400'
                          : 'border-transparent text-zinc-400 hover:text-zinc-200'
                      }`}
                      onClick={() => setTab(item.id)}
                    >
                      {item.label}
                      {item.badge}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3">
                {activeTab === 'comments' &&
                  (commentsLoading ? (
                    <Spinner className="text-zinc-500" />
                  ) : liveComments ? (
                    liveComments.comments.length === 0 ? (
                      <p className="text-sm text-zinc-500">{t.detail.noComments}</p>
                    ) : (
                      /* max-w-[70ch]: largura máxima de leitura (handoff regra 4) */
                      <div className="max-w-[70ch] space-y-2">
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
                    <div className="max-w-[70ch] space-y-2">
                      <p className="text-xs text-zinc-600">{t.detail.commentsOfflineHint}</p>
                      {localComments.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5"
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
                  ))}

                {activeTab === 'history' &&
                  (changelogLoading ? (
                    <Spinner className="text-zinc-500" />
                  ) : changelogFailed ? (
                    <p className="text-sm text-amber-400 light:text-amber-600">
                      {t.changelog.error}
                    </p>
                  ) : !changelogData || changelogData.entries.length === 0 ? (
                    <p className="text-sm text-zinc-500">{t.changelog.empty}</p>
                  ) : (
                    <div className="space-y-2">
                      {changelogData.entries.map((entry) => (
                        <ChangelogEntryRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  ))}

                {activeTab === 'worklogs' && <WorklogsTab issueKey={issueKey} />}

                {activeTab === 'prs' && (
                  <div className="space-y-1.5">
                    {prs.map((pr) => (
                      <PullRequestRow key={`${pr.repo}#${pr.number}`} pr={pr} />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {!docked && composer}

            <NotesSection issueKey={issueKey} />
          </div>
        )}
      </div>
      {/* docado: composer ancorado no rodapé, fora da área rolável (handoff B3) */}
      {docked && issue && (
        <div className="border-t border-zinc-800 bg-zinc-950/60 px-4 pt-2.5 pb-3">{composer}</div>
      )}
    </>
  )
}

/**
 * Metadados do card: fila de chips na gaveta (560px) e grade de duas colunas
 * no painel docado — em 380px não cabe o trilho lateral, então rótulo em cima
 * e valor embaixo.
 */
function IssueMetaFields({
  variant,
  issue,
  reporterName,
  sprintName
}: {
  variant: DetailVariant
  issue: Issue
  reporterName: string | null
  sprintName: string | null
}): React.JSX.Element {
  interface MetaField {
    label: string
    icon: typeof Zap
    /** valor da fila de chips (pode repetir o rótulo, ex.: "Relator: Ana") */
    value: string
    /** valor da grade, onde o rótulo já aparece em cima */
    dockedValue?: string
    /** title do chip — só onde já existia, para não criar tooltip novo na gaveta */
    title?: string
  }

  const fields: MetaField[] = []
  if (issue.assigneeName) {
    fields.push({
      label: t.detail.assigneeLabel,
      icon: UserRound,
      value: issue.assigneeName,
      title: t.detail.assigneeLabel
    })
  }
  if (reporterName) {
    fields.push({
      label: t.detail.reporterLabel,
      icon: UserRoundPen,
      value: t.detail.reporter(reporterName),
      dockedValue: reporterName,
      title: t.detail.reporterLabel
    })
  }
  if (issue.storyPoints !== null) {
    fields.push({
      label: t.detail.storyPointsLabel,
      icon: Ruler,
      value: t.detail.storyPoints(issue.storyPoints)
    })
  }
  if (issue.priority) {
    fields.push({ label: t.detail.priorityLabel, icon: Flag, value: issue.priority })
  }
  if (sprintName) {
    fields.push({ label: 'Sprint', icon: Zap, value: sprintName })
  }

  if (variant === 'docked') {
    return (
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10px] font-bold tracking-[.06em] text-zinc-500 uppercase">
              {f.label}
            </dt>
            <dd
              className="mt-0.5 truncate text-[12.5px] text-zinc-200"
              title={f.dockedValue ?? f.value}
            >
              {f.dockedValue ?? f.value}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
      {fields.map((f) => (
        <span key={f.label} className="flex items-center gap-1" title={f.title}>
          <f.icon size={12} /> {f.value}
        </span>
      ))}
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

  return (
    <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="space-y-2">
        <div className="grid grid-cols-[130px_1fr] items-center gap-2">
          <span className="text-xs text-zinc-500">{t.detail.assigneeLabel}</span>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            />
          </div>
        )}
        {meta.priority.editable && (
          <div className="grid grid-cols-[130px_1fr] items-center gap-2">
            <span className="text-xs text-zinc-500">{t.detail.priorityLabel}</span>
            <select
              value={priorityId}
              onChange={(e) => setPriorityId(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
              className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
              <CheckCircle2 size={14} className="text-green-400 light:text-green-600" />
            ) : null}
            {saveBusy ? t.detail.saving : t.detail.save}
          </Button>
        </div>
        {saveError && <p className="text-sm text-amber-400 light:text-amber-600">{saveError}</p>}
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
    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
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
      {error && <p className="text-sm text-amber-400 light:text-amber-600">{error}</p>}
    </div>
  )
}

/**
 * Menu dropdown de templates de comentário — reutilizado pelo editor de comentário novo e
 * pela edição de um comentário existente (ambos passam a ref do textarea que estão
 * controlando). Insere o conteúdo do template na posição do cursor: se houver texto e o
 * cursor estiver no fim, prefixa com quebra de linha; senão insere direto na posição.
 * Depois de inserir, se o template tiver placeholders `{...}`, seleciona o primeiro para
 * o usuário digitar por cima. Também permite salvar o texto atual do textarea como um
 * novo template via um mini-form inline.
 */
function TemplatesMenu({
  textareaRef,
  value,
  onChange
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery({
    queryKey: ['comment-templates'],
    queryFn: () => invoke('templates:list', {}),
    staleTime: 60_000,
    enabled: open
  })

  // fecha com clique fora ou Esc, só ouvindo enquanto o dropdown está aberto
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const closeMenu = (): void => {
    setOpen(false)
    setShowSaveForm(false)
    setTemplateName('')
    setSaveError(null)
  }

  const insertTemplate = (content: string): void => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const atEnd = value.length > 0 && start === value.length && end === value.length
    const needsBreak = atEnd && !value.endsWith('\n')
    const insertText = needsBreak ? `\n${content}` : content
    const next = value.slice(0, start) + insertText + value.slice(end)
    onChange(next)
    const base = start + (needsBreak ? 1 : 0)
    const placeholder = content.match(/\{[^}]+\}/)
    const selStart = placeholder ? base + (placeholder.index ?? 0) : base + content.length
    const selEnd = placeholder ? selStart + placeholder[0].length : selStart
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(selStart, selEnd)
    })
    closeMenu()
  }

  const saveCurrentAsTemplate = async (): Promise<void> => {
    if (!templateName.trim() || !value.trim()) return
    setSaveBusy(true)
    setSaveError(null)
    try {
      await invoke('templates:save', { name: templateName.trim(), content: value.trim() })
      void queryClient.invalidateQueries({ queryKey: ['comment-templates'] })
      closeMenu()
    } catch (err) {
      setSaveError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setSaveBusy(false)
    }
  }

  const templates = data?.templates ?? []

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        title="Templates de comentário"
        aria-label="Templates de comentário"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <LibraryBig size={14} />
      </button>
      {/* popover flutuante: superfície opaca e um degrau acima do painel */}
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 max-h-64 min-w-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800 shadow-lg">
          {templates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">
              Nenhum template — salve um comentário como template.
            </p>
          ) : (
            <ul className="py-1">
              {templates.map((tpl) => {
                const firstLine = tpl.content.split('\n')[0]
                return (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
                      onClick={() => insertTemplate(tpl.content)}
                    >
                      <span className="block truncate text-sm font-medium text-zinc-200">
                        {tpl.name}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{firstLine}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-t border-zinc-800 p-1.5">
            {showSaveForm ? (
              <div className="space-y-1.5">
                <Input
                  autoFocus
                  className="text-xs"
                  placeholder="Nome do template"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveCurrentAsTemplate()
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    disabled={saveBusy || !templateName.trim()}
                    onClick={() => void saveCurrentAsTemplate()}
                  >
                    {saveBusy ? <Spinner /> : null}
                    {t.common.save}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={saveBusy}
                    onClick={() => setShowSaveForm(false)}
                  >
                    {t.common.cancel}
                  </Button>
                </div>
                {saveError && (
                  <p className="text-xs text-amber-400 light:text-amber-600">{saveError}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!value.trim()}
                onClick={() => setShowSaveForm(true)}
              >
                Salvar comentário atual como template…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Um comentário ao vivo. Se for do usuário atual, mostra ações discretas de
 * editar/excluir no header; edição troca o corpo por um textarea prefilled com o
 * markdown do comentário (preserva a formatação); exclusão pede confirmação
 * inline (sem window.confirm), que expira sozinha em 5s.
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
  const [body, setBody] = useState(comment.bodyMarkdown)
  const [editViewMode, setEditViewMode] = useState<'edit' | 'preview'>('edit')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
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
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
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
                  setBody(comment.bodyMarkdown)
                  setEditViewMode('edit')
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
                className="font-medium text-red-400 hover:underline disabled:opacity-50 light:text-red-600"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? <Spinner className="text-red-400 light:text-red-600" /> : t.detail.yes}
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
          <div className="flex items-center justify-between gap-2">
            <EditPreviewTabs mode={editViewMode} onChange={setEditViewMode} />
            {editViewMode === 'edit' && (
              <div className="flex items-center gap-1">
                <MarkdownToolbar
                  textareaRef={bodyRef}
                  value={body}
                  onChange={setBody}
                  aiContext="comment"
                />
                <TemplatesMenu textareaRef={bodyRef} value={body} onChange={setBody} />
              </div>
            )}
          </div>
          {editViewMode === 'edit' ? (
            <textarea
              ref={bodyRef}
              className="h-20 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          ) : (
            <div className="h-20 w-full overflow-y-auto rounded-md border border-zinc-800 p-3">
              <MarkdownLite text={body} />
            </div>
          )}
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
      {error && <p className="mt-1 text-sm text-amber-400 light:text-amber-600">{error}</p>}
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
  liveMarkdown,
  descriptionLoading,
  mediaResolver,
  descExpanded,
  onExpand
}: {
  issue: Issue
  issueKey: string
  liveDescription: unknown | null
  liveMarkdown: string | null
  descriptionLoading: boolean
  mediaResolver: ReturnType<typeof useMediaResolver>
  descExpanded: boolean
  onExpand: () => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(liveMarkdown ?? issue.descriptionText ?? '')
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEdit = (): void => {
    if (descriptionLoading) return
    setValue(liveMarkdown ?? issue.descriptionText ?? '')
    setViewMode('edit')
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
          O texto usa markdown — use a barra acima ou a prévia.
        </p>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <EditPreviewTabs mode={viewMode} onChange={setViewMode} />
          {viewMode === 'edit' && (
            <MarkdownToolbar
              textareaRef={descriptionRef}
              value={value}
              onChange={setValue}
              aiContext="description"
            />
          )}
        </div>
        {viewMode === 'edit' ? (
          <textarea
            ref={descriptionRef}
            className="min-h-40 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        ) : (
          <div className="min-h-40 w-full overflow-y-auto rounded-md border border-zinc-800 p-3">
            <MarkdownLite text={value} />
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : null}
            {busy ? t.detail.saving : t.detail.save}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        </div>
        {error && <p className="mt-1 text-sm text-amber-400 light:text-amber-600">{error}</p>}
      </section>
    )
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {t.detail.description}
        </h3>
        <button
          className="text-xs text-indigo-400 hover:underline disabled:opacity-50 disabled:hover:no-underline light:text-indigo-600"
          onClick={startEdit}
          disabled={descriptionLoading}
          title={descriptionLoading ? 'Carregando…' : undefined}
        >
          Editar
        </button>
      </div>
      {/* max-w-[70ch]: largura máxima de leitura (handoff regra 4) */}
      <div className="max-w-[70ch]">
        {liveDescription ? (
          <AdfDescriptionBody
            doc={liveDescription}
            mediaResolver={mediaResolver}
            expanded={descExpanded}
            onExpand={onExpand}
          />
        ) : issue.descriptionText ? (
          <DescriptionBody
            text={issue.descriptionText}
            expanded={descExpanded}
            onExpand={onExpand}
          />
        ) : (
          <p className="text-sm text-zinc-500">Sem descrição.</p>
        )}
      </div>
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
        <button
          className="mt-1 text-xs text-indigo-400 hover:underline light:text-indigo-600"
          onClick={onExpand}
        >
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
      <p className="rounded-md bg-zinc-950/60 p-3 text-sm whitespace-pre-wrap text-zinc-300">
        {shown}
        {truncated && '…'}
      </p>
      {truncated && (
        <button
          className="mt-1 text-xs text-indigo-400 hover:text-indigo-300 light:text-indigo-600 light:hover:text-indigo-700"
          onClick={onExpand}
        >
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
          <div className="mt-1 line-clamp-2 rounded-sm bg-zinc-950/60 px-2 py-1 text-xs text-zinc-400">
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

/** Uma entrada do histórico (changelog) do Jira: autor + data relativa, uma linha por campo alterado. */
function ChangelogEntryRow({ entry }: { entry: ChangelogEntry }): React.JSX.Element {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-300">{entry.authorName ?? '—'}</span>
        <span className="shrink-0 text-xs text-zinc-600">{compactAgo(entry.createdAt)}</span>
      </div>
      <div className="space-y-0.5">
        {entry.items.map((item, i) => (
          <p key={i} className="text-xs text-zinc-400">
            <span className="text-zinc-300">{item.field}</span>: {item.from ?? t.changelog.cleared}{' '}
            → {item.to ?? t.changelog.cleared}
          </p>
        ))}
      </div>
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
      const res = await invoke('issues:logWork', {
        key: issueKey,
        timeSpent: formatJiraDuration(timer.seconds),
        comment: 'Registrado pelo timer do Jiraiya'
      })
      timer.reset()
      void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['worklogs', issueKey] })
      if (res.queued) onError(t.queue.queuedToast)
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
    // rodando é o único estado que vira pílula preenchida: é o sinal mais forte
    // do cabeçalho (indigo-600 preenche, texto branco — regra de cor do DS)
    return (
      <div className="flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 py-0.5 pr-0.5 pl-2 text-white">
        <span className="font-mono text-[11.5px] font-semibold tabular-nums">
          {formatTimer(timer.seconds)}
        </span>
        <button
          className="rounded p-1 hover:bg-white/15"
          onClick={timer.pause}
          title="Pausar timer"
          aria-label="Pausar timer"
        >
          <Pause size={13} />
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
        className="rounded-md p-1 text-xs font-medium text-indigo-400 hover:underline disabled:opacity-50 light:text-indigo-600"
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
            className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-lg font-semibold text-zinc-100 outline-none focus:border-indigo-500"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') cancel()
            }}
          />
          <button
            className="shrink-0 rounded-md p-1 text-green-400 hover:bg-zinc-800 disabled:opacity-50 light:text-green-600"
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
        {error && <p className="text-sm text-amber-400 light:text-amber-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-1.5">
      <h2 className="max-w-[70ch] text-base leading-[1.35] font-bold text-pretty text-zinc-50">
        {issue.summary}
      </h2>
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
 * Aba "Worklogs": total registrado, formulário de apontamento e a lista de
 * lançamentos. Só é montada quando a aba está ativa — é isso que mantém o
 * `worklog:list` lazy, como era no accordion.
 *
 * O "Registrado: X" mora aqui, e não mais no painel Editar, porque quem
 * dispara as três mutações que mudam o total (apontar, editar, apagar) é esta
 * aba: sem fio pai→filho atravessando o corpo do card. `pendingTotal` guarda
 * o total que a própria resposta do IPC devolveu — é a mesma autoridade que
 * alimenta `worklog:list.totalTimeSpent` (ambos vêm de `issueTimeTracking`) e
 * chega antes do refetch da lista, então o valor troca na hora.
 */
function WorklogsTab({ issueKey }: { issueKey: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data, isLoading } = useWorklogs(issueKey)

  const [pendingTotal, setPendingTotal] = useState<string | null | undefined>(undefined)
  const registered = pendingTotal !== undefined ? pendingTotal : (data?.totalTimeSpent ?? null)

  const [timeSpentInput, setTimeSpentInput] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logSaved, setLogSaved] = useState(false)

  const handleLogWork = async (): Promise<void> => {
    if (!timeSpentInput.trim()) return
    setLogBusy(true)
    setLogError(null)
    try {
      const res = await invoke('issues:logWork', {
        key: issueKey,
        timeSpent: timeSpentInput.trim()
      })
      setPendingTotal(res.totalTimeSpent)
      setTimeSpentInput('')
      void queryClient.invalidateQueries({ queryKey: ['worklogs', issueKey] })
      void queryClient.invalidateQueries({ queryKey: ['issue-editmeta', issueKey] })
      if (res.queued) {
        setLogError(t.queue.queuedToast)
      } else {
        setLogSaved(true)
        setTimeout(() => setLogSaved(false), 3000)
      }
    } catch (err) {
      setLogError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setLogBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">{t.detail.timeSpentRegistered(registered)}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={t.detail.timeSpentPlaceholder}
            value={timeSpentInput}
            onChange={(e) => setTimeSpentInput(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          />
          <Button
            variant="secondary"
            disabled={!timeSpentInput.trim() || logBusy}
            onClick={() => void handleLogWork()}
          >
            {logBusy ? (
              <Spinner />
            ) : logSaved ? (
              <CheckCircle2 size={14} className="text-green-400 light:text-green-600" />
            ) : null}
            {logBusy ? t.detail.logging : t.detail.logWork}
          </Button>
        </div>
        <p className="text-xs text-zinc-600">{t.detail.timeSpentHint}</p>
        {logError && <p className="text-sm text-amber-400 light:text-amber-600">{logError}</p>}
      </div>

      <div className="space-y-1.5 border-t border-zinc-800 pt-3">
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
              onTotalChanged={setPendingTotal}
            />
          ))
        )}
      </div>
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
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm">
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
                className="font-medium text-red-400 hover:underline disabled:opacity-50 light:text-red-600"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                {busy ? <Spinner className="text-red-400 light:text-red-600" /> : t.detail.yes}
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
      {error && <p className="mt-1 text-sm text-amber-400 light:text-amber-600">{error}</p>}
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
    <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
      <select
        value={typeValue}
        onChange={(e) => setTypeValue(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
      {error && <p className="text-sm text-amber-400 light:text-amber-600">{error}</p>}
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
    emerald: 'bg-emerald-900/50 text-emerald-300 light:bg-emerald-100 light:text-emerald-700',
    purple: 'bg-purple-900/50 text-purple-300 light:bg-purple-100 light:text-purple-700',
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-900/50 text-amber-300 light:bg-amber-100 light:text-amber-700',
    green: 'bg-green-900/50 text-green-300 light:bg-green-100 light:text-green-700',
    red: 'bg-red-900/50 text-red-300 light:bg-red-100 light:text-red-700'
  }
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
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
      className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5 text-left text-sm hover:bg-zinc-950/60"
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

/**
 * Envolve `AttachmentsSection` (de ./attachments) com upload: botão "Anexar"
 * (input file oculto, multiple) e drop de arquivos em toda a área da seção.
 * Mantém sua própria query de contagem (mesma chave de `AttachmentsSection`,
 * cache compartilhado) só para decidir se mostra o título "Anexos" — quando já
 * há anexos, o título com contagem vem do próprio `AttachmentsSection`.
 */
function AttachmentsUploadSection({ issueKey }: { issueKey: string }): React.JSX.Element {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['issue-attachments', issueKey],
    queryFn: () => invoke('issues:attachments', { key: issueKey }),
    staleTime: 60_000,
    retry: 0
  })
  const hasAttachments = (data?.attachments.length ?? 0) > 0

  const uploadFiles = async (files: FileList | File[]): Promise<void> => {
    setError(null)
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`Arquivo muito grande (máx. 20MB): ${file.name}`)
        continue
      }
      setUploadingName(file.name)
      try {
        const dataBase64 = await fileToBase64(file)
        await invoke('issues:attachmentUpload', { key: issueKey, filename: file.name, dataBase64 })
        void queryClient.invalidateQueries({ queryKey: ['issue-attachments', issueKey] })
      } catch (err) {
        setError(err instanceof IpcError ? err.message : t.common.error)
      }
    }
    setUploadingName(null)
  }

  return (
    <section
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files)
      }}
    >
      {!hasAttachments && (
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {t.detail.attachmentsTitle}
        </h3>
      )}
      <div className="mb-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={14} />
          Anexar
        </Button>
        {uploadingName && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Spinner /> Enviando {uploadingName}…
          </span>
        )}
      </div>
      {error && <p className="mb-2 text-sm text-amber-400 light:text-amber-600">{error}</p>}
      <AttachmentsSection issueKey={issueKey} />
    </section>
  )
}

/**
 * Seção "Notas (só suas)" — última da gaveta. Fica só neste app (nunca vai
 * para o Jira). Só monta o editor (`NoteEditor`) depois que o fetch resolve,
 * então o valor inicial vem direto da prop — sem useEffect de sincronização
 * (mesmo padrão do `EditPanel`, que também só monta após o fetch do editMeta).
 */
function NotesSection({ issueKey }: { issueKey: string }): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['note', issueKey],
    queryFn: () => invoke('notes:get', { key: issueKey }),
    enabled: true // a gaveta só monta este componente quando o card está aberto
  })

  return (
    <section className="space-y-2 border-t border-zinc-800 pt-4">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        <Lock size={12} />
        Notas (só suas)
      </h3>
      {isLoading ? (
        <Spinner className="text-zinc-500" />
      ) : (
        <NoteEditor issueKey={issueKey} initialContent={data?.content ?? ''} />
      )}
    </section>
  )
}

/** Editor de nota privada: debounce de 800ms após digitar, com flush no blur. */
function NoteEditor({
  issueKey,
  initialContent
}: {
  issueKey: string
  initialContent: string
}): React.JSX.Element {
  const [value, setValue] = useState(initialContent)
  const [synced, setSynced] = useState(true)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const flush = (content: string): void => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void invoke('notes:set', { key: issueKey, content }).then(() => setSynced(true))
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setValue(next)
    setSynced(false)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => flush(next), 800)
  }

  return (
    <>
      <textarea
        className="h-20 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
        placeholder="Notas privadas — ficam só neste app, nunca vão para o Jira."
        value={value}
        onChange={handleChange}
        onBlur={() => flush(value)}
      />
      {synced && <p className="text-xs text-zinc-600">salvo</p>}
    </>
  )
}
