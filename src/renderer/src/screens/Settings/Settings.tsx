import { createContext, useContext, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Bell,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  SquarePen,
  Terminal,
  User,
  X
} from 'lucide-react'
import type { AiFeature, AiProviderId, DensityPref, Prefs } from '@shared/domain'
import { invoke, IpcError } from '../../api/client'
import {
  useAiStatus,
  useAuthStatus,
  useInProgressStatuses,
  useOpenRouterModels,
  usePrefs,
  usePrStatus,
  useProjects,
  useSyncStatus
} from '../../api/hooks'
import { applyDensityPref } from '../../lib/density'
import { useQueue } from '../../lib/queue'
import { compactAgo, compactUntil } from '../../lib/relativeTime'
import { useNow } from '../../lib/useNow'
import { Badge, Button, Card, ScreenHeader, Spinner, Toggle } from '../../components/ui'
import { QueueBadge } from '../../components/QueueCenter'
import { CommandLogModal } from '../../components/CommandLogModal'
import { ModelCombobox } from '../../components/ModelCombobox'
import { AI_FEATURES, cardMatches, norm, SEARCH_INDEX, type GroupId } from './searchIndex'

type CommentTemplate = { id: number; name: string; content: string }

const GROUPS: Array<{ id: GroupId; label: string; icon: typeof User }> = [
  { id: 'account', label: 'Conta', icon: User },
  { id: 'sync', label: 'Sincronização', icon: RefreshCw },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'appearance', label: 'Aparência', icon: Palette },
  { id: 'ai', label: 'Inteligência artificial', icon: Sparkles },
  { id: 'prs', label: 'Pull requests', icon: GitBranch },
  { id: 'templates', label: 'Templates', icon: SquarePen },
  { id: 'data', label: 'Dados e backup', icon: Database },
  { id: 'updates', label: 'Atualizações', icon: Download }
]

/** Termo da busca já normalizado; '' quando não há busca. */
const SearchQueryCtx = createContext('')
/** true quando o cartão casou pelo título — aí as linhas param de se filtrar. */
const ShowAllRowsCtx = createContext(true)

const SELECT_CLASS =
  'shrink-0 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200 outline-none focus:border-indigo-500'
const FIELD_CLASS =
  'w-[230px] shrink-0 rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1 text-[12.5px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500'

export default function Settings(): React.JSX.Element {
  const [group, setGroup] = useState<GroupId>('account')
  const [rawQuery, setRawQuery] = useState('')
  const query = norm(rawQuery)

  const { data: auth } = useAuthStatus()
  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => invoke('app:info', {})
  })

  // a busca salta para o grupo do primeiro resultado; sem isso o usuário digitaria
  // no vazio enquanto o painel continua mostrando o grupo anterior
  const search = (value: string): void => {
    setRawQuery(value)
    const next = norm(value)
    if (!next) return
    const hit = SEARCH_INDEX.find((entry) => cardMatches(entry, next))
    if (hit) setGroup(hit.group)
  }

  const groupHasHit = !query || SEARCH_INDEX.some((e) => e.group === group && cardMatches(e, query))
  const groupLabel = GROUPS.find((g) => g.id === group)?.label ?? ''

  const context = [auth?.workspace?.email, auth?.workspace?.siteUrl, `Jiraiya v${appInfo?.version}`]
    .filter((part) => part && !part.includes('undefined'))
    .join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenHeader
        title="Configurações"
        context={context}
        actions={
          <div className="flex w-[230px] items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[12.5px] focus-within:border-zinc-700">
            <Search size={13} className="shrink-0 text-zinc-500" />
            <input
              aria-label="Buscar configuração"
              placeholder="Buscar configuração…"
              className="min-w-0 flex-1 bg-transparent text-zinc-200 placeholder-zinc-500 outline-none"
              value={rawQuery}
              onChange={(e) => search(e.target.value)}
            />
            {rawQuery && (
              <button
                className="shrink-0 text-zinc-500 hover:text-zinc-300"
                aria-label="Limpar busca"
                onClick={() => setRawQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[212px] shrink-0 flex-col gap-0.5 border-r border-zinc-800 bg-zinc-950/60 p-3.5">
          {GROUPS.map((item) => {
            const active = item.id === group
            const Icon = item.icon
            return (
              <button
                key={item.id}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors ${
                  active
                    ? 'bg-indigo-600/12 font-semibold text-indigo-400'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                onClick={() => setGroup(item.id)}
              >
                <Icon size={15} className="shrink-0" />
                {item.label}
              </button>
            )
          })}

          {/* "Sobre" deixou de ser cartão: virou o rodapé do índice */}
          <div className="mt-auto border-t border-zinc-800 px-3 pt-3">
            <div className="text-[11.5px] text-zinc-500">
              Jiraiya{appInfo?.version ? ` v${appInfo.version}` : ''}
            </div>
            <a
              className="mt-0.5 block text-[11.5px] text-indigo-400 hover:underline"
              href="https://github.com/thiagopcdev"
              target="_blank"
              rel="noreferrer"
            >
              feito por @thiagopcdev
            </a>
          </div>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-[18px_24px]">
          <SearchQueryCtx.Provider value={query}>
            <div className="flex max-w-[720px] flex-col gap-3.5">
              {groupHasHit ? (
                <GroupPanel group={group} />
              ) : (
                <p className="text-[13px] text-zinc-500">
                  Nada em {groupLabel} para “{rawQuery.trim()}”.
                </p>
              )}
            </div>
          </SearchQueryCtx.Provider>
        </div>
      </div>
    </div>
  )
}

function GroupPanel({ group }: { group: GroupId }): React.JSX.Element {
  switch (group) {
    case 'account':
      return <AccountSection />
    case 'sync':
      return (
        <>
          <SyncSection />
          <InProgressStatusSection />
          <ProjectsSection />
          <SyncStateSection />
        </>
      )
    case 'notifications':
      return (
        <>
          <NotificationsSection />
          <WorklogReminderSection />
        </>
      )
    case 'appearance':
      return <AppearanceSection />
    case 'ai':
      return <AiSection />
    case 'prs':
      return <PullRequestsSection />
    case 'templates':
      return <TemplatesSection />
    case 'data':
      return (
        <>
          <BackupSection />
          <StorageSection />
        </>
      )
    case 'updates':
      return <UpdateSection />
  }
}

/**
 * Cartão de um bloco de configuração. Some inteiro quando a busca não casa com
 * o título nem com nenhum rótulo dele; quando casa pelo TÍTULO, libera todas as
 * linhas (buscar "aparência" mostra o cartão completo, não uma linha só).
 */
function SettingsCard({
  title,
  actions,
  bodyClassName,
  children
}: {
  title: string
  actions?: ReactNode
  bodyClassName?: string
  children: ReactNode
}): React.JSX.Element | null {
  const query = useContext(SearchQueryCtx)
  const entry = SEARCH_INDEX.find((e) => e.card === title)
  const titleHit = !query || norm(title).includes(query)

  if (query && entry && !cardMatches(entry, query)) return null

  return (
    <ShowAllRowsCtx.Provider value={titleHit}>
      <Card title={title} actions={actions} bodyClassName={bodyClassName}>
        {children}
      </Card>
    </ShowAllRowsCtx.Provider>
  )
}

/** Corpo de cartão feito só de linhas: o padding vertical vem das próprias linhas. */
const ROWS_BODY = 'px-4 pt-1 pb-3'

/**
 * Linha de configuração — padrão único da tela (CONTRATO.md), no lugar do antigo
 * SelectRow e dos <label> soltos.
 *
 * `htmlFor` só quando o controle é um CAMPO (select/input): <label for> ligado a
 * um <button> rouba o nome acessível dele ("Desconectar" viraria o rótulo da
 * linha). O Toggle, que é <button role="switch">, é nomeado por `aria-labelledby`.
 */
function SettingRow({
  id,
  htmlFor,
  label,
  hint,
  control
}: {
  id: string
  htmlFor?: string
  label: string
  hint?: ReactNode
  control: ReactNode
}): React.JSX.Element | null {
  const query = useContext(SearchQueryCtx)
  const showAll = useContext(ShowAllRowsCtx)
  if (query && !showAll && !norm(label).includes(query)) return null

  return (
    <div className="flex items-center gap-4 border-b border-zinc-800/60 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <label id={`${id}-label`} htmlFor={htmlFor} className="block text-[13.5px] text-zinc-200">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-zinc-500">{hint}</div>}
      </div>
      {control}
    </div>
  )
}

function SelectSetting({
  id,
  label,
  hint,
  value,
  options,
  onChange
}: {
  id: string
  label: string
  hint?: ReactNode
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}): React.JSX.Element | null {
  return (
    <SettingRow
      id={id}
      htmlFor={id}
      label={label}
      hint={hint}
      control={
        <select
          id={id}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      }
    />
  )
}

function ToggleSetting({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  id: string
  label: string
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element | null {
  return (
    <SettingRow
      id={id}
      label={label}
      hint={hint}
      control={
        <Toggle
          id={id}
          aria-labelledby={`${id}-label`}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
      }
    />
  )
}

/** Grava prefs e revalida o cache — o mesmo gesto repetido por quase todo cartão. */
function usePrefsUpdater(): (patch: Partial<Prefs>) => Promise<void> {
  const queryClient = useQueryClient()
  return async (patch) => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }
}

function LoadingCard({ title }: { title: string }): React.JSX.Element | null {
  return (
    <SettingsCard title={title}>
      <Spinner className="text-zinc-500" />
    </SettingsCard>
  )
}

function AccountSection(): React.JSX.Element | null {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data } = useAuthStatus()
  const [busy, setBusy] = useState(false)

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('auth:disconnect', {})
      await queryClient.invalidateQueries()
      void navigate('/onboarding')
    } finally {
      setBusy(false)
    }
  }

  const workspace = data?.workspace

  return (
    <SettingsCard title="Conta" bodyClassName={workspace ? ROWS_BODY : 'p-4'}>
      {workspace ? (
        <SettingRow
          id="account-disconnect"
          label="Conta conectada"
          hint={[workspace.displayName ?? workspace.email, workspace.email, workspace.siteUrl]
            .filter(Boolean)
            .join(' · ')}
          control={
            <Button
              variant="danger"
              className="shrink-0"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {busy && <Spinner />}
              Desconectar
            </Button>
          }
        />
      ) : (
        <p className="text-sm text-zinc-500">Nenhuma conta conectada.</p>
      )}
    </SettingsCard>
  )
}

function AppearanceSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()

  if (!prefs) return <LoadingCard title="Aparência" />

  const setDensity = async (next: DensityPref): Promise<void> => {
    // aplica no <html> antes do round-trip: a densidade é puramente visual e
    // esperar o prefs:set daria um piscar de layout
    applyDensityPref(next)
    await update({ density: next })
  }

  return (
    <SettingsCard title="Aparência" bodyClassName={ROWS_BODY}>
      <SelectSetting
        id="appearance-theme"
        label="Tema"
        hint="Sistema segue o modo claro/escuro do macOS/Windows."
        value={prefs.theme}
        options={[
          ['dark', 'Escuro'],
          ['light', 'Claro'],
          ['system', 'Sistema']
        ]}
        onChange={(v) => void update({ theme: v as Prefs['theme'] })}
      />
      <SelectSetting
        id="appearance-density"
        label="Densidade"
        hint="Denso reduz o espaçamento das listas; o tamanho da fonte não muda."
        value={prefs.density}
        options={[
          ['comfortable', 'Confortável'],
          ['compact', 'Denso']
        ]}
        onChange={(v) => void setDensity(v as DensityPref)}
      />
    </SettingsCard>
  )
}

function NotificationsSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()

  if (!prefs) return <LoadingCard title="Notificações" />

  return (
    <SettingsCard title="Notificações" bodyClassName={ROWS_BODY}>
      <ToggleSetting
        id="notify-assigned"
        label="Notificar quando um card for atribuído a mim"
        checked={prefs.notifyAssignedToMe}
        onChange={(next) => void update({ notifyAssignedToMe: next })}
      />
      <ToggleSetting
        id="notify-mentions"
        label="Notificar quando eu for mencionado"
        checked={prefs.notifyMentions}
        onChange={(next) => void update({ notifyMentions: next })}
      />
      <ToggleSetting
        id="notify-alerts"
        label="Notificar alertas críticos"
        hint="Notificação nativa do sistema."
        checked={prefs.notifyCriticalAlerts}
        onChange={(next) => void update({ notifyCriticalAlerts: next })}
      />
      <ToggleSetting
        id="notify-daily"
        label="Gerar minha daily no primeiro uso do dia"
        hint="Com notificação quando o resumo ficar pronto."
        checked={prefs.morningBriefing}
        onChange={(next) => void update({ morningBriefing: next })}
      />
    </SettingsCard>
  )
}

function WorklogReminderSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()

  if (!prefs) return <LoadingCard title="Lembrete de tempo" />

  return (
    <SettingsCard title="Lembrete de tempo" bodyClassName={ROWS_BODY}>
      <ToggleSetting
        id="worklog-reminder"
        label="Lembrar de registrar tempo"
        hint="Notifica em dias úteis quando nenhum worklog foi lançado no dia."
        checked={prefs.worklogReminder}
        onChange={(next) => void update({ worklogReminder: next })}
      />
      <SettingRow
        id="worklog-reminder-time"
        htmlFor="worklog-reminder-time"
        label="Horário do lembrete"
        control={
          <input
            id="worklog-reminder-time"
            type="time"
            disabled={!prefs.worklogReminder}
            className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:text-zinc-600`}
            value={prefs.worklogReminderTime}
            onChange={(e) => void update({ worklogReminderTime: e.target.value })}
          />
        }
      />
    </SettingsCard>
  )
}

/**
 * O que conta como trabalho EM CURSO. O Jira só tem três categorias, e a do
 * meio ("em progresso") junta "Em andamento" com "Code Review", "Pronto para
 * Teste" e "Aguardando Deploy" — por isso a tela Hoje mostrava como em
 * andamento card que já saiu da sua mão. A lista de status vem dos dados do
 * workspace, não de um enum: cada projeto nomeia o fluxo do seu jeito.
 *
 * Vazio = todos (comportamento histórico), e é assim que os chips aparecem
 * quando o usuário nunca escolheu: todos marcados.
 */
function InProgressStatusSection(): React.JSX.Element | null {
  const { data: prefs } = usePrefs()
  const { data, isLoading } = useInProgressStatuses()
  const savePrefs = usePrefsUpdater()
  const [busy, setBusy] = useState(false)

  const statuses = data?.statuses ?? []
  const escolhidos = prefs?.inProgressStatuses ?? []
  const todos = escolhidos.length === 0
  const marcado = (status: string): boolean =>
    todos || escolhidos.some((s) => norm(s) === norm(status))

  const toggle = async (status: string): Promise<void> => {
    // primeiro clique parte de "todos marcados", que é o que a tela mostra
    const base = todos ? statuses.map((s) => s.status) : escolhidos
    const proximos = marcado(status)
      ? base.filter((s) => norm(s) !== norm(status))
      : [...base, status]
    // desmarcar tudo voltaria ao comportamento "todos" sem o usuário pedir
    if (proximos.length === 0) return
    setBusy(true)
    try {
      // marcar todos de volta é o mesmo que "sem filtro"
      const patch = proximos.length === statuses.length ? [] : proximos
      await savePrefs({ inProgressStatuses: patch })
    } finally {
      setBusy(false)
    }
  }

  const marcados = statuses.filter((s) => marcado(s.status)).length

  return (
    <SettingsCard
      title="O que é trabalho em andamento"
      actions={
        statuses.length > 0 && (
          <Badge color="brand">
            {marcados} de {statuses.length}
          </Badge>
        )
      }
    >
      <p className="mb-2.5 text-[11.5px] leading-snug text-zinc-500">
        Vale para o bloco “Em andamento” e para a contagem de parados na tela Hoje, e para os
        números por pessoa na tela Time. Sem nenhuma escolha, conta a categoria inteira do Jira.
      </p>
      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && statuses.length === 0 && (
        <p className="text-[12.5px] text-zinc-500">
          Nenhum card em progresso sincronizado ainda — rode uma sincronização.
        </p>
      )}
      <div className="flex flex-wrap gap-[7px]">
        {statuses.map((s) => (
          <button
            key={s.status}
            disabled={busy}
            aria-pressed={marcado(s.status)}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors disabled:opacity-50 ${
              marcado(s.status)
                ? 'border-indigo-600 bg-indigo-600/12 font-semibold text-indigo-400'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
            onClick={() => void toggle(s.status)}
            title={`${s.mine} ${s.mine === 1 ? 'card seu' : 'cards seus'} · ${s.total} no total`}
          >
            {s.status}
            <span className="ml-1.5 text-[10.5px] font-normal opacity-70">{s.mine}</span>
          </button>
        ))}
      </div>
    </SettingsCard>
  )
}

function ProjectsSection(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data, isLoading } = useProjects(false)
  const projects = data?.projects ?? []
  const [busy, setBusy] = useState(false)

  const toggle = async (key: string): Promise<void> => {
    const selected = projects.filter((p) => p.selected).map((p) => p.key)
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    setBusy(true)
    try {
      await invoke('projects:setSelected', { keys: next })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = projects.filter((p) => p.selected).length

  return (
    <SettingsCard
      title="Projetos acompanhados"
      actions={
        projects.length > 0 && (
          <Badge color="brand">
            {selectedCount} de {projects.length}
          </Badge>
        )
      }
    >
      {isLoading && <Spinner className="text-zinc-500" />}
      <div className="flex flex-wrap gap-[7px]">
        {projects.map((p) => (
          <button
            key={p.key}
            disabled={busy}
            className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors disabled:opacity-50 ${
              p.selected
                ? 'border-indigo-600 bg-indigo-600/12 font-semibold text-indigo-400'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
            onClick={() => void toggle(p.key)}
            title={p.name}
          >
            {p.key}
          </button>
        ))}
      </div>
    </SettingsCard>
  )
}

function SyncSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()
  const { data: sync } = useSyncStatus()

  if (!prefs) return <LoadingCard title="Ritmo de sincronização" />

  return (
    <SettingsCard
      title="Ritmo de sincronização"
      actions={<SyncFreshness sync={sync} />}
      bodyClassName={ROWS_BODY}
    >
      <SelectSetting
        id="sync-interval"
        label="Intervalo de sincronização"
        value={String(prefs.syncIntervalMinutes)}
        options={[
          ['5', '5 minutos'],
          ['15', '15 minutos'],
          ['30', '30 minutos'],
          ['60', '1 hora']
        ]}
        onChange={(v) => void update({ syncIntervalMinutes: Number(v) })}
      />
      <SelectSetting
        id="sync-backfill"
        label="Janela de histórico"
        hint="Quanto passado o app busca no primeiro sync de cada projeto."
        value={String(prefs.backfillDays)}
        options={[
          ['14', '14 dias'],
          ['30', '30 dias'],
          ['60', '60 dias'],
          ['90', '90 dias']
        ]}
        onChange={(v) => void update({ backfillDays: Number(v) })}
      />
      <SelectSetting
        id="sync-stalled"
        label="Considerar ticket parado após"
        value={String(prefs.stalledDays)}
        options={[
          ['2', '2 dias'],
          ['3', '3 dias'],
          ['5', '5 dias'],
          ['7', '7 dias']
        ]}
        onChange={(v) => void update({ stalledDays: Number(v) })}
      />
      <SelectSetting
        id="board-done-days"
        label="Mostrar concluídos do quadro dos últimos"
        hint='Espelhe aqui o "ocultar itens concluídos com mais de" do seu quadro no Jira — a API não expõe esse ajuste.'
        value={String(prefs.boardDoneDays)}
        options={[
          ['1', '1 dia'],
          ['7', '1 semana'],
          ['14', '2 semanas'],
          ['30', '1 mês']
        ]}
        onChange={(v) => void update({ boardDoneDays: Number(v) })}
      />
      <SelectSetting
        id="sync-mode"
        label="Modo de sincronização"
        hint="Pessoal traz só o que está ligado a você; por projeto traz o quadro inteiro."
        value={prefs.syncMode}
        options={[
          ['project', 'Por projeto'],
          ['personal', 'Pessoal']
        ]}
        onChange={(v) => void update({ syncMode: v as Prefs['syncMode'] })}
      />
    </SettingsCard>
  )
}

/** Indicador da faixa de título: em dia, rodando ou nunca sincronizado. */
function SyncFreshness({
  sync
}: {
  sync: { running: boolean; lastSuccessAt: string | null } | undefined
}): React.JSX.Element {
  if (sync?.running) {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
        <Spinner className="text-zinc-500" />
        sincronizando…
      </span>
    )
  }
  if (!sync?.lastSuccessAt) {
    return <span className="text-[11.5px] text-zinc-500">nunca sincronizado</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-green-400 light:text-green-600">
      <CheckCircle2 size={12} />
      última {compactAgo(sync.lastSuccessAt)}
    </span>
  )
}

/**
 * Cartão novo: junta o que estava espalhado — última sincronização, fila offline
 * (o badge que só existia na sidebar) e o registro de requisições, que ficava
 * escondido no fim do cartão de IA.
 */
function SyncStateSection(): React.JSX.Element | null {
  const { data: sync } = useSyncStatus()
  const { pendingCount, failedCount } = useQueue()
  const [showLog, setShowLog] = useState(false)

  const queued = pendingCount + failedCount
  const running = sync?.running === true
  const lastSync = sync?.lastSuccessAt
    ? `${format(new Date(sync.lastSuccessAt), "d 'de' MMMM, HH:mm", { locale: ptBR })} · ${compactAgo(sync.lastSuccessAt)}`
    : 'Ainda não sincronizado nesta máquina.'

  // contagem para o próximo sync automático; now=0 é o render anterior ao
  // primeiro tique do relógio. Enquanto roda, a próxima é o que menos importa.
  const now = useNow(15_000)
  const nextSync =
    sync?.nextRunAt && now > 0 && !running ? compactUntil(sync.nextRunAt, new Date(now)) : null

  return (
    <SettingsCard title="Estado da sincronização" bodyClassName={ROWS_BODY}>
      <SettingRow
        id="sync-now"
        label="Última sincronização"
        hint={
          <>
            {lastSync}
            {nextSync && <span className="mt-0.5 block">Próxima automática: {nextSync}</span>}
            {sync?.lastError && (
              <span className="mt-0.5 block text-red-400 light:text-red-600">{sync.lastError}</span>
            )}
          </>
        }
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={running}
            onClick={() => void invoke('sync:run', {})}
          >
            {running ? <Spinner /> : <RefreshCw size={13} />}
            {running ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        }
      />
      <SettingRow
        id="sync-queue"
        label="Fila offline"
        hint="Ações feitas sem rede, aguardando envio."
        control={
          queued > 0 ? (
            // o QueueBadge nasceu para a sidebar (largura cheia, margem embaixo);
            // aqui ele entra como controle de linha, então neutralizamos as duas
            <div className="shrink-0 [&>button]:mb-0 [&>button]:w-auto">
              <QueueBadge />
            </div>
          ) : (
            <span className="shrink-0 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11.5px] font-bold text-zinc-400">
              vazia
            </span>
          )
        }
      />
      <SettingRow
        id="sync-log"
        label="Registro de requisições"
        hint="Últimas chamadas aos CLIs de IA e ao gh, para investigar falha."
        control={
          <button
            id="sync-log"
            className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-indigo-400 hover:underline"
            onClick={() => setShowLog(true)}
          >
            <Terminal size={13} />
            Abrir
          </button>
        }
      />
      {/* a sincronização normal é incremental: ela nunca vê o que foi apagado no
          Jira. A completa reconcilia o cache e remove os cards excluídos. */}
      <SettingRow
        id="sync-full"
        label="Sincronização completa"
        hint="Refaz a janela de histórico e remove do app os cards excluídos no Jira."
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={running}
            onClick={() => void invoke('sync:run', { full: true })}
          >
            {running ? 'Sincronizando…' : 'Sincronizar tudo'}
          </Button>
        }
      />

      {showLog && <CommandLogModal onClose={() => setShowLog(false)} />}
    </SettingsCard>
  )
}

function PullRequestsSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()
  const { data: prStatus } = usePrStatus()

  if (!prefs) return <LoadingCard title="Pull requests (GitHub)" />

  return (
    <SettingsCard title="Pull requests (GitHub)" bodyClassName={ROWS_BODY}>
      <ToggleSetting
        id="pr-integration"
        label="Mostrar PRs relacionados ao card"
        hint="Usa o CLI gh instalado na máquina para buscar PRs que mencionam a key do card. Opcional — requer gh instalado e autenticado."
        checked={prefs.prIntegration}
        onChange={(next) => void update({ prIntegration: next })}
      />
      <SettingRow
        id="pr-scope"
        htmlFor="pr-scope"
        label="Escopo da busca"
        hint="Qualificadores extras da busca no GitHub; vazio busca em todo o GitHub."
        control={
          <input
            id="pr-scope"
            className={FIELD_CLASS}
            placeholder="org:biudtech"
            value={prefs.prSearchScope}
            onChange={(e) => void update({ prSearchScope: e.target.value })}
          />
        }
      />
      {prStatus?.ghAvailable === false && (
        <p className="mt-3 rounded-md bg-amber-950/40 px-3 py-2 text-[11.5px] text-amber-400 light:bg-amber-50 light:text-amber-700">
          CLI gh não encontrado — a integração ficará inativa até instalar (brew install gh).
        </p>
      )}
    </SettingsCard>
  )
}

function AiSection(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const update = usePrefsUpdater()
  const { data: aiStatus } = useAiStatus()
  const { data: prefs } = usePrefs()

  const [key, setKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const activeId = aiStatus?.active?.id ?? null
  const activeProvider = activeId ? aiStatus?.providers.find((p) => p.id === activeId) : null
  const openrouterProvider = aiStatus?.providers.find((p) => p.id === 'openrouter')
  const openrouterHasKey = Boolean(openrouterProvider?.available)
  const { data: openrouterModels, isLoading: openrouterModelsLoading } = useOpenRouterModels(
    activeId === 'openrouter'
  )

  const invalidateAi = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['ai-status'] }),
      queryClient.invalidateQueries({ queryKey: ['openrouter-models'] })
    ])
  }

  const setProvider = async (pref: string): Promise<void> => {
    await update({ aiProvider: pref as Prefs['aiProvider'] })
    await invalidateAi()
  }

  const setFeatureModel = (feature: AiFeature, modelId: string): void => {
    if (!activeId) return
    const current = { ...(prefs?.aiModels?.[activeId] ?? {}) }
    if (modelId) {
      current[feature] = modelId
    } else {
      delete current[feature]
    }
    void update({ aiModels: { ...prefs?.aiModels, [activeId]: current } })
  }

  const saveKey = async (): Promise<void> => {
    const trimmed = key.trim()
    if (!trimmed) return
    setKeyBusy(true)
    setKeyError(null)
    try {
      await invoke('ai:setOpenRouterKey', { key: trimmed })
      setKey('')
      await invalidateAi()
    } catch (err) {
      setKeyError(err instanceof IpcError ? err.message : 'Falha ao salvar a chave.')
    } finally {
      setKeyBusy(false)
    }
  }

  const removeKey = async (): Promise<void> => {
    setRemoveBusy(true)
    try {
      await invoke('ai:clearOpenRouterKey', {})
      await invalidateAi()
    } finally {
      setRemoveBusy(false)
    }
  }

  if (!aiStatus || !prefs) return <LoadingCard title="Inteligência artificial" />

  const providerOptions: Array<[string, string]> = [
    ['auto', 'Automático (Claude se disponível)'],
    ...aiStatus.providers.map((p): [string, string] => [
      p.id,
      p.id === 'openrouter' ? 'OpenRouter' : p.label
    ])
  ]

  return (
    <SettingsCard title="Inteligência artificial" bodyClassName="px-4 pt-3 pb-3">
      <div className="space-y-1.5">
        {aiStatus.providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={`size-2 shrink-0 rounded-full ${p.available ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="shrink-0 text-zinc-300">
              {p.id === 'openrouter' ? 'OpenRouter' : p.label}
            </span>
            {p.detail && (
              <span
                className={`truncate text-[11.5px] text-zinc-500 ${p.kind === 'cli' ? 'font-mono' : ''}`}
              >
                {p.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      {!activeId && (
        <p className="mt-3 rounded-md bg-amber-950/40 px-3 py-2 text-[11.5px] text-amber-400 light:bg-amber-50 light:text-amber-700">
          Nenhum provider de IA disponível — instale o Claude Code, o Gemini CLI, o Codex CLI ou
          configure uma chave da OpenRouter abaixo.
        </p>
      )}

      <div className="mt-1">
        <SelectSetting
          id="ai-provider"
          label="Provider ativo"
          value={prefs.aiProvider}
          options={providerOptions}
          onChange={(v) => void setProvider(v)}
        />
        <SettingRow
          id="ai-openrouter-key"
          htmlFor={openrouterHasKey ? undefined : 'ai-openrouter-key'}
          label="Chave da OpenRouter"
          hint="Guardada criptografada no Keychain."
          control={
            openrouterHasKey ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="flex items-center gap-1 text-[11.5px] text-green-400 light:text-green-600">
                  <CheckCircle2 size={13} /> configurada
                </span>
                <Button variant="danger" disabled={removeBusy} onClick={() => void removeKey()}>
                  {removeBusy && <Spinner />}
                  Remover
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <input
                  id="ai-openrouter-key"
                  type="password"
                  className={FIELD_CLASS}
                  placeholder="sk-or-…"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={keyBusy || !key.trim()}
                  onClick={() => void saveKey()}
                >
                  {keyBusy && <Spinner />}
                  Salvar
                </Button>
              </div>
            )
          }
        />
      </div>

      {keyError && <p className="mt-2 text-[11.5px] text-red-400 light:text-red-600">{keyError}</p>}

      {activeId && activeProvider && (
        <div className="mt-3 border-t border-zinc-800 pt-1">
          <p className="pt-2 text-[11.5px] text-zinc-500">
            Modelo usado em cada funcionalidade ({activeProvider.label}):
          </p>
          {AI_FEATURES.map((f) =>
            activeId === 'openrouter' ? (
              <SettingRow
                key={f.key}
                id={`ai-model-${f.key}`}
                htmlFor={`ai-model-${f.key}`}
                label={f.label}
                control={
                  // o popover do combobox é absolute: o Card de propósito não tem
                  // overflow-hidden (ui.tsx), então a lista não é cortada
                  <div className="w-[300px] shrink-0">
                    <ModelCombobox
                      id={`ai-model-${f.key}`}
                      value={prefs.aiModels?.openrouter?.[f.key] ?? ''}
                      onChange={(id) => setFeatureModel(f.key, id)}
                      models={openrouterModels?.models ?? []}
                      hasKey={openrouterHasKey}
                      loading={openrouterModelsLoading}
                    />
                  </div>
                }
              />
            ) : (
              <SelectSetting
                key={f.key}
                id={`ai-model-${f.key}`}
                label={f.label}
                value={prefs.aiModels?.[activeId as AiProviderId]?.[f.key] ?? ''}
                options={[
                  ['', 'Padrão (recomendado)'],
                  ...activeProvider.models.map((m): [string, string] => [m.id, m.label])
                ]}
                onChange={(v) => setFeatureModel(f.key, v)}
              />
            )
          )}
        </div>
      )}
    </SettingsCard>
  )
}

function TemplatesSection(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['comment-templates'],
    queryFn: () => invoke('templates:list', {})
  })
  const templates = data?.templates ?? []

  const [editing, setEditing] = useState<CommentTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)

  const showForm = creating || editing !== null

  const startEdit = (template: CommentTemplate): void => {
    setEditing(template)
    setCreating(false)
    setName(template.name)
    setContent(template.content)
  }

  const startCreate = (): void => {
    setEditing(null)
    setCreating(true)
    setName('')
    setContent('')
  }

  const cancel = (): void => {
    setEditing(null)
    setCreating(false)
  }

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['comment-templates'] })
  }

  const save = async (): Promise<void> => {
    if (!name.trim() || !content.trim()) return
    setBusy(true)
    try {
      await invoke('templates:save', {
        id: editing?.id,
        name: name.trim(),
        content: content.trim()
      })
      await invalidate()
      setEditing(null)
      setCreating(false)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number): Promise<void> => {
    if (!window.confirm('Apagar este template?')) return
    await invoke('templates:delete', { id })
    await invalidate()
  }

  return (
    <SettingsCard
      title="Templates de comentário"
      actions={templates.length > 0 && <Badge color="brand">{templates.length}</Badge>}
    >
      <div className="space-y-3">
        <p className="text-[11.5px] leading-snug text-zinc-500">
          Use {'{placeholders}'} — ao inserir, o primeiro fica selecionado para digitar por cima.
          Disponíveis no editor de comentário da gaveta.
        </p>

        {isLoading && <Spinner className="text-zinc-500" />}
        {!isLoading && templates.length === 0 && (
          <p className="text-[13px] text-zinc-500">Nenhum template ainda.</p>
        )}

        {templates.length > 0 && (
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="rounded-md border border-zinc-800 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] text-zinc-200">{template.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => startEdit(template)}>
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(template.id)}>
                      Apagar
                    </Button>
                  </div>
                </div>
                <p className="mt-1 truncate text-[11.5px] text-zinc-500">{template.content}</p>
              </div>
            ))}
          </div>
        )}

        {showForm ? (
          <div className="space-y-2 rounded-md border border-zinc-700 p-3">
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-zinc-400">Nome</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-indigo-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] font-medium text-zinc-400">Conteúdo</span>
              <textarea
                className="h-20 w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/60 p-2 text-[13px] text-zinc-100 outline-none focus:border-indigo-500"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={busy || !name.trim() || !content.trim()}
                onClick={() => void save()}
              >
                {busy && <Spinner />}
                Salvar
              </Button>
              <Button variant="ghost" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={startCreate}>
            + Novo template
          </Button>
        )}
      </div>
    </SettingsCard>
  )
}

function BackupSection(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const [exportBusy, setExportBusy] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doExport = async (): Promise<void> => {
    setExportBusy(true)
    setError(null)
    try {
      const res = await invoke('backup:export', {})
      if (res.path) setExportPath(res.path)
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Falha ao exportar backup.')
    } finally {
      setExportBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    if (
      !window.confirm(
        'Importar mescla os dados do arquivo com os atuais (nada é apagado). Continuar?'
      )
    ) {
      return
    }
    setImportBusy(true)
    setError(null)
    try {
      const res = await invoke('backup:import', {})
      if (!res.canceled) {
        const { notes, watches, filters, templates, prefs } = res.imported
        setImportMsg(
          `Importado: ${notes} notas, ${watches} seguidos, ${filters} filtros, ${templates} templates` +
            (prefs ? ' (preferências aplicadas)' : '')
        )
        void queryClient.invalidateQueries()
      }
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Falha ao importar backup.')
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <SettingsCard title="Backup" bodyClassName={ROWS_BODY}>
      <SettingRow
        id="backup-export"
        label="Exportar backup"
        hint="Só o que existe neste app: notas privadas, cards seguidos, filtros salvos, templates e preferências."
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={exportBusy}
            onClick={() => void doExport()}
          >
            {exportBusy && <Spinner />}
            Exportar backup…
          </Button>
        }
      />
      <SettingRow
        id="backup-import"
        label="Importar backup"
        hint="Mescla o arquivo com os dados atuais; nada é apagado."
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={importBusy}
            onClick={() => void doImport()}
          >
            {importBusy && <Spinner />}
            Importar backup…
          </Button>
        }
      />
      {exportPath && (
        <p
          className="mt-2 truncate text-[11.5px] text-green-400 light:text-green-600"
          title={exportPath}
        >
          Backup salvo em {exportPath}
        </p>
      )}
      {importMsg && (
        <p className="mt-2 text-[11.5px] text-green-400 light:text-green-600">{importMsg}</p>
      )}
      {error && <p className="mt-2 text-[11.5px] text-amber-400 light:text-amber-600">{error}</p>}
    </SettingsCard>
  )
}

function UpdateSection(): React.JSX.Element | null {
  const update = usePrefsUpdater()
  const { data: prefs } = usePrefs()
  const {
    data,
    refetch,
    isFetching: checking
  } = useQuery({
    queryKey: ['update-check-settings'],
    queryFn: () => invoke('update:check', {}),
    enabled: false
  })
  const [token, setToken] = useState('')
  const [tokenBusy, setTokenBusy] = useState(false)

  const saveToken = async (): Promise<void> => {
    const trimmed = token.trim()
    if (!trimmed) return
    setTokenBusy(true)
    try {
      await invoke('update:setToken', { token: trimmed })
      setToken('')
      await refetch()
    } finally {
      setTokenBusy(false)
    }
  }

  const removeToken = async (): Promise<void> => {
    setTokenBusy(true)
    try {
      await invoke('update:setToken', { token: null })
      await refetch()
    } finally {
      setTokenBusy(false)
    }
  }

  if (!prefs) return <LoadingCard title="Atualizações" />

  return (
    <SettingsCard title="Atualizações" bodyClassName={ROWS_BODY}>
      <ToggleSetting
        id="update-check"
        label="Verificar novas versões automaticamente"
        checked={prefs.updateCheck}
        onChange={(next) => void update({ updateCheck: next })}
      />
      <SettingRow
        id="update-now"
        label="Nova versão"
        hint={
          checking ? (
            'Verificando…'
          ) : data?.error ? (
            <span className="text-amber-400 light:text-amber-600">{data.error}</span>
          ) : data?.available && data.latest ? (
            <span className="text-zinc-300">
              v{data.latest} disponível
              {data.url && (
                <a
                  className="ml-2 inline-flex items-center gap-1 text-indigo-400 hover:underline"
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={12} /> ver
                </a>
              )}
            </span>
          ) : data ? (
            'Você está na versão mais recente.'
          ) : (
            'Ainda não verificado nesta sessão.'
          )
        }
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={checking}
            onClick={() => void refetch()}
          >
            {checking && <Spinner />}
            Verificar agora
          </Button>
        }
      />
      <SettingRow
        id="update-token"
        htmlFor="update-token"
        label="Token do GitHub"
        hint="Opcional, necessário só para repo privado. Guardado criptografado no Keychain, escopo mínimo: repo (read)."
        control={
          <div className="flex shrink-0 items-center gap-2">
            <input
              id="update-token"
              type="password"
              className={FIELD_CLASS}
              placeholder={data?.tokenConfigured ? 'configurado' : 'ghp_…'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={tokenBusy || !token.trim()}
              onClick={() => void saveToken()}
            >
              {tokenBusy && <Spinner />}
              Salvar
            </Button>
            {data?.tokenConfigured && (
              <Button variant="danger" disabled={tokenBusy} onClick={() => void removeToken()}>
                Remover
              </Button>
            )}
          </div>
        }
      />
    </SettingsCard>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StorageSection(): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['temp-files'],
    queryFn: () => invoke('app:tempFiles', {})
  })
  const [busy, setBusy] = useState(false)
  const [freedMsg, setFreedMsg] = useState<string | null>(null)

  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await invoke('app:tempClear', {})
      await queryClient.invalidateQueries({ queryKey: ['temp-files'] })
      setFreedMsg(`Liberado ${formatBytes(res.freedBytes)}`)
      setTimeout(() => setFreedMsg(null), 3000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard title="Armazenamento" bodyClassName={ROWS_BODY}>
      <SettingRow
        id="storage-clear"
        label="Arquivos temporários de anexos"
        hint={
          <>
            {data ? formatBytes(data.bytes) : '—'} em cache
            {freedMsg && (
              <span className="ml-2 text-green-400 light:text-green-600">{freedMsg}</span>
            )}
          </>
        }
        control={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={busy}
            onClick={() => void clear()}
          >
            {busy && <Spinner />}
            Limpar
          </Button>
        }
      />
    </SettingsCard>
  )
}
