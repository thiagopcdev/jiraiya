import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Terminal } from 'lucide-react'
import type { AiFeature, AiProviderId, Prefs } from '@shared/domain'
import { invoke, IpcError } from '../../api/client'
import {
  useAiStatus,
  useAuthStatus,
  useOpenRouterModels,
  usePrefs,
  usePrStatus,
  useProjects
} from '../../api/hooks'
import { Button, Card, Input, Spinner } from '../../components/ui'
import { CommandLogModal } from '../../components/CommandLogModal'
import { ModelCombobox } from '../../components/ModelCombobox'

type CommentTemplate = { id: number; name: string; content: string }

export default function Settings(): React.JSX.Element {
  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">Configurações</h2>
      <AccountSection />
      <AppearanceSection />
      <WorklogReminderSection />
      <ProjectsSection />
      <SyncSection />
      <PullRequestsSection />
      <AiSection />
      <TemplatesSection />
      <BackupSection />
      <UpdateSection />
      <StorageSection />
      <AboutSection />
    </div>
  )
}

function AccountSection(): React.JSX.Element {
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

  return (
    <Card title="Conta">
      {data?.workspace ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm text-zinc-200">
              {data.workspace.displayName ?? data.workspace.email}
            </div>
            <div className="truncate text-xs text-zinc-500">
              {data.workspace.email} · {data.workspace.siteUrl}
            </div>
          </div>
          <Button variant="danger" disabled={busy} onClick={() => void disconnect()}>
            {busy && <Spinner />}
            Desconectar
          </Button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Nenhuma conta conectada.</p>
      )}
    </Card>
  )
}

function AppearanceSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: prefs } = usePrefs()

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  if (!prefs) return <Card title="Aparência">{<Spinner className="text-zinc-500" />}</Card>

  return (
    <Card title="Aparência">
      <div className="space-y-2">
        <SelectRow
          label="Tema"
          value={prefs.theme}
          options={[
            ['dark', 'Escuro'],
            ['light', 'Claro'],
            ['system', 'Sistema']
          ]}
          onChange={(v) => void update({ theme: v as Prefs['theme'] })}
        />
        <p className="text-xs text-zinc-500">Sistema segue o modo claro/escuro do macOS/Windows.</p>
      </div>
    </Card>
  )
}

function WorklogReminderSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: prefs } = usePrefs()

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  if (!prefs) return <Card title="Lembrete de tempo">{<Spinner className="text-zinc-500" />}</Card>

  return (
    <Card title="Lembrete de tempo">
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          <span>
            Lembrar de registrar tempo
            <span className="mt-0.5 block text-xs text-zinc-500">
              Notifica em dias úteis quando nenhum worklog foi lançado no dia.
            </span>
          </span>
          <input
            type="checkbox"
            className="ml-4 shrink-0 accent-indigo-600"
            checked={prefs.worklogReminder}
            onChange={(e) => void update({ worklogReminder: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm text-zinc-300">
          Horário do lembrete
          <input
            type="time"
            disabled={!prefs.worklogReminder}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-600"
            value={prefs.worklogReminderTime}
            onChange={(e) => void update({ worklogReminderTime: e.target.value })}
          />
        </label>
      </div>
    </Card>
  )
}

function ProjectsSection(): React.JSX.Element {
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

  return (
    <Card title="Projetos acompanhados">
      {isLoading && <Spinner className="text-zinc-500" />}
      <div className="flex flex-wrap gap-2">
        {projects.map((p) => (
          <button
            key={p.key}
            disabled={busy}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              p.selected
                ? 'border-indigo-600 bg-indigo-950/60 text-indigo-200'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
            onClick={() => void toggle(p.key)}
            title={p.name}
          >
            {p.key}
          </button>
        ))}
      </div>
    </Card>
  )
}

function SyncSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: prefs } = usePrefs()

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  if (!prefs) return <Card title="Sincronização">{<Spinner className="text-zinc-500" />}</Card>

  return (
    <Card title="Sincronização e alertas">
      <div className="space-y-4">
        <SelectRow
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
        <SelectRow
          label="Janela de histórico (backfill)"
          value={String(prefs.backfillDays)}
          options={[
            ['14', '14 dias'],
            ['30', '30 dias'],
            ['60', '60 dias'],
            ['90', '90 dias']
          ]}
          onChange={(v) => void update({ backfillDays: Number(v) })}
        />
        <SelectRow
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
        <SelectRow
          label="Modo de sincronização"
          value={prefs.syncMode}
          options={[
            ['project', 'Por projeto (tudo dos projetos selecionados)'],
            ['personal', 'Pessoal (só issues ligadas a mim)']
          ]}
          onChange={(v) => void update({ syncMode: v as Prefs['syncMode'] })}
        />
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          Notificar quando um card for atribuído a mim
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.notifyAssignedToMe}
            onChange={(e) => void update({ notifyAssignedToMe: e.target.checked })}
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          Notificar quando eu for mencionado
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.notifyMentions}
            onChange={(e) => void update({ notifyMentions: e.target.checked })}
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          Notificar alertas críticos (notificação nativa)
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.notifyCriticalAlerts}
            onChange={(e) => void update({ notifyCriticalAlerts: e.target.checked })}
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          Gerar minha daily no primeiro uso do dia (com notificação)
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.morningBriefing}
            onChange={(e) => void update({ morningBriefing: e.target.checked })}
          />
        </label>
      </div>
    </Card>
  )
}

function PullRequestsSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: prefs } = usePrefs()
  const { data: prStatus } = usePrStatus()

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

  if (!prefs)
    return <Card title="Pull requests (GitHub)">{<Spinner className="text-zinc-500" />}</Card>

  return (
    <Card title="Pull requests (GitHub)">
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          <span>
            Mostrar PRs relacionados ao card
            <span className="mt-0.5 block text-xs text-zinc-500">
              Usa o CLI gh instalado na máquina para buscar PRs que mencionam a key do card.
              Opcional — requer gh instalado e autenticado.
            </span>
          </span>
          <input
            type="checkbox"
            className="ml-4 shrink-0 accent-indigo-600"
            checked={prefs.prIntegration}
            onChange={(e) => void update({ prIntegration: e.target.checked })}
          />
        </label>

        {prStatus?.ghAvailable === false && (
          <p className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-400">
            CLI gh não encontrado — a integração ficará inativa até instalar (brew install gh).
          </p>
        )}

        <Input
          label="Escopo da busca"
          placeholder="org:biudtech"
          hint="Qualificadores extras da busca no GitHub; vazio busca em todo o GitHub."
          value={prefs.prSearchScope}
          onChange={(e) => void update({ prSearchScope: e.target.value })}
        />
      </div>
    </Card>
  )
}

function SelectRow({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-zinc-300">
      {label}
      <select
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Funcionalidades com modelo configurável, na ordem mostrada em Ajustes. */
const AI_FEATURES: Array<{ key: AiFeature; label: string }> = [
  { key: 'summaries', label: 'Resumos (daily/weekly/1:1)' },
  { key: 'team', label: 'Narrativa do time' },
  { key: 'draft', label: 'Criar task (rascunho)' },
  { key: 'split', label: 'Dividir task (análise)' },
  { key: 'comment', label: 'Comentário de card (IA)' },
  { key: 'ask', label: 'Perguntar ao Jiraiya' }
]

function AiSection(): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data: aiStatus } = useAiStatus()
  const { data: prefs } = usePrefs()

  const [key, setKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)

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

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
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

  if (!aiStatus || !prefs) {
    return <Card title="Inteligência artificial">{<Spinner className="text-zinc-500" />}</Card>
  }

  const providerOptions: Array<[string, string]> = [
    ['auto', 'Automático (Claude se disponível)'],
    ...aiStatus.providers.map((p): [string, string] => [
      p.id,
      p.id === 'openrouter' ? 'OpenRouter' : p.label
    ])
  ]

  return (
    <Card title="Inteligência artificial">
      <div className="space-y-4">
        <div className="space-y-1.5">
          {aiStatus.providers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span
                className={`size-2 shrink-0 rounded-full ${p.available ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="shrink-0 text-zinc-300">
                {p.id === 'openrouter' ? 'OpenRouter' : p.label}
              </span>
              {p.detail && (
                <span
                  className={`truncate text-xs text-zinc-500 ${p.kind === 'cli' ? 'font-mono' : ''}`}
                >
                  {p.detail}
                </span>
              )}
            </div>
          ))}
        </div>

        {!activeId && (
          <p className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-400 light:bg-amber-50 light:text-amber-700">
            Nenhum provider de IA disponível — instale o Claude Code, o Gemini CLI, o Codex CLI ou
            configure uma chave da OpenRouter abaixo.
          </p>
        )}

        <SelectRow
          label="Provider ativo"
          value={prefs.aiProvider}
          options={providerOptions}
          onChange={(v) => void setProvider(v)}
        />

        <div className="space-y-1.5 border-t border-zinc-800 pt-3">
          <span className="block text-xs font-medium text-zinc-400">Chave da OpenRouter</span>
          {openrouterHasKey ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-green-400">
                <CheckCircle2 size={13} /> chave configurada
              </span>
              <Button variant="danger" disabled={removeBusy} onClick={() => void removeKey()}>
                {removeBusy && <Spinner />}
                Remover
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Input
                type="password"
                className="flex-1"
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
          )}
          {keyError && <p className="text-xs text-red-400 light:text-red-600">{keyError}</p>}
        </div>

        {activeId && activeProvider && (
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-500">
              Modelo usado em cada funcionalidade ({activeProvider.label}):
            </p>
            {AI_FEATURES.map((f) =>
              activeId === 'openrouter' ? (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-400">{f.label}</span>
                  <ModelCombobox
                    value={prefs.aiModels?.openrouter?.[f.key] ?? ''}
                    onChange={(id) => setFeatureModel(f.key, id)}
                    models={openrouterModels?.models ?? []}
                    hasKey={openrouterHasKey}
                    loading={openrouterModelsLoading}
                  />
                </label>
              ) : (
                <SelectRow
                  key={f.key}
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

        <button
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() => setShowLog(true)}
        >
          <Terminal size={12} />
          Ver comandos executados
        </button>
      </div>

      {showLog && <CommandLogModal onClose={() => setShowLog(false)} />}
    </Card>
  )
}

function TemplatesSection(): React.JSX.Element {
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
    <Card title="Templates de comentário">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Use {'{placeholders}'} — ao inserir, o primeiro fica selecionado para digitar por cima.
          Disponíveis no editor de comentário da gaveta.
        </p>

        {isLoading && <Spinner className="text-zinc-500" />}
        {!isLoading && templates.length === 0 && (
          <p className="text-sm text-zinc-500">Nenhum template ainda.</p>
        )}

        {templates.length > 0 && (
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="rounded-md border border-zinc-800 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-zinc-200">{template.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => startEdit(template)}>
                      Editar
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(template.id)}>
                      Apagar
                    </Button>
                  </div>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{template.content}</p>
              </div>
            ))}
          </div>
        )}

        {showForm ? (
          <div className="space-y-2 rounded-md border border-zinc-700 p-3">
            <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">Conteúdo</span>
              <textarea
                className="h-20 w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
    </Card>
  )
}

function BackupSection(): React.JSX.Element {
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
    <Card title="Backup">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Exporta o que só existe neste app: notas privadas, cards seguidos, filtros salvos,
          templates e preferências. Os dados do Jira são ressincronizáveis.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={exportBusy} onClick={() => void doExport()}>
            {exportBusy && <Spinner />}
            Exportar backup…
          </Button>
          <Button variant="secondary" disabled={importBusy} onClick={() => void doImport()}>
            {importBusy && <Spinner />}
            Importar backup…
          </Button>
        </div>
        {exportPath && (
          <p className="truncate text-xs text-green-400" title={exportPath}>
            Backup salvo em {exportPath}
          </p>
        )}
        {importMsg && <p className="text-xs text-green-400">{importMsg}</p>}
        {error && <p className="text-xs text-amber-400 light:text-amber-600">{error}</p>}
      </div>
    </Card>
  )
}

function UpdateSection(): React.JSX.Element {
  const queryClient = useQueryClient()
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

  const update = async (patch: Partial<Prefs>): Promise<void> => {
    await invoke('prefs:set', patch)
    void queryClient.invalidateQueries({ queryKey: ['prefs'] })
  }

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

  if (!prefs) return <Card title="Atualizações">{<Spinner className="text-zinc-500" />}</Card>

  return (
    <Card title="Atualizações">
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between text-sm text-zinc-300">
          Verificar novas versões automaticamente
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.updateCheck}
            onChange={(e) => void update({ updateCheck: e.target.checked })}
          />
        </label>

        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="min-w-0 flex-1">
            {checking && <Spinner className="text-zinc-500" />}
            {!checking && !data && (
              <span className="text-zinc-500">Ainda não verificado nesta sessão.</span>
            )}
            {!checking && data?.error && <span className="text-amber-400">{data.error}</span>}
            {!checking && data && !data.error && data.available && data.latest && (
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
            )}
            {!checking && data && !data.error && !data.available && (
              <span className="text-zinc-500">Você está na versão mais recente.</span>
            )}
          </div>
          <Button variant="secondary" disabled={checking} onClick={() => void refetch()}>
            {checking && <Spinner />}
            Verificar agora
          </Button>
        </div>

        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex items-end gap-2">
            <Input
              label="Token do GitHub (opcional — necessário para repo privado)"
              type="password"
              className="flex-1"
              placeholder={data?.tokenConfigured ? 'configurado' : ''}
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
          {data?.tokenConfigured && <p className="text-xs text-green-400">Token configurado.</p>}
          <p className="text-xs text-zinc-500">
            Guardado criptografado no Keychain, escopo mínimo: repo (read).
          </p>
        </div>
      </div>
    </Card>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StorageSection(): React.JSX.Element {
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
    <Card title="Armazenamento">
      <div className="flex items-center justify-between gap-4 text-sm">
        <div>
          <div className="text-zinc-200">
            Arquivos temporários de anexos: {data ? formatBytes(data.bytes) : '—'}
          </div>
          {freedMsg && <div className="mt-1 text-xs text-green-400">{freedMsg}</div>}
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void clear()}>
          {busy && <Spinner />}
          Limpar
        </Button>
      </div>
    </Card>
  )
}

function AboutSection(): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => invoke('app:info', {})
  })
  return (
    <Card title="Sobre">
      <div className="flex items-center justify-between gap-4 text-sm">
        <div>
          <div className="text-zinc-200">Jiraiya{data?.version ? ` v${data.version}` : ''}</div>
          <div className="text-xs text-zinc-500">
            Seu histórico de trabalho no Jira, sem planilha.
          </div>
        </div>
        <a
          className="flex items-center gap-1.5 text-indigo-400 hover:underline"
          href="https://github.com/thiagopcdev"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          feito por @thiagopcdev
        </a>
      </div>
    </Card>
  )
}
