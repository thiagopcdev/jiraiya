import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import type { Prefs } from '@shared/domain'
import { invoke } from '../../api/client'
import { useAuthStatus, usePrefs, useProjects } from '../../api/hooks'
import { Button, Card, Spinner } from '../../components/ui'

export default function Settings(): React.JSX.Element {
  return (
    <div className="max-w-2xl space-y-5 p-6">
      <h2 className="text-xl font-semibold text-zinc-100">Configurações</h2>
      <AccountSection />
      <ProjectsSection />
      <SyncSection />
      <ClaudeSection />
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
          Notificar alertas críticos (notificação nativa)
          <input
            type="checkbox"
            className="accent-indigo-600"
            checked={prefs.notifyCriticalAlerts}
            onChange={(e) => void update({ notifyCriticalAlerts: e.target.checked })}
          />
        </label>
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

function ClaudeSection(): React.JSX.Element {
  const { data } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })
  return (
    <Card title="Claude">
      {data?.available ? (
        <p className="flex items-center gap-2 text-sm text-zinc-300">
          <CheckCircle2 size={15} className="text-green-400" />
          Claude disponível
          <span className="truncate font-mono text-xs text-zinc-500">{data.path}</span>
        </p>
      ) : (
        <div className="text-sm text-zinc-400">
          <p className="flex items-center gap-2">
            <XCircle size={15} className="text-zinc-500" />
            CLI do Claude não encontrado — resumos usarão apenas o template.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Instale o Claude Code e faça login para habilitar o aprimoramento com IA.
          </p>
        </div>
      )}
    </Card>
  )
}
