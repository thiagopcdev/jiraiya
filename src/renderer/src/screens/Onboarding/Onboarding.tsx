import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { useProjects, useSyncStatus } from '../../api/hooks'
import { Button, Card, Input, Spinner } from '../../components/ui'
import { t } from '../../strings/ptBR'

type Step = 'connect' | 'projects' | 'sync'

export default function Onboarding(): React.JSX.Element {
  const [step, setStep] = useState<Step>('connect')
  return (
    <div
      className="flex h-full items-center justify-center p-6"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="w-full max-w-lg"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <h1 className="mb-1 text-center text-3xl font-bold text-zinc-100">{t.app.name}</h1>
        <p className="mb-6 text-center text-sm text-zinc-500">
          Seu histórico de trabalho no Jira, sem planilha.
        </p>
        {step === 'connect' && <ConnectStep onDone={() => setStep('projects')} />}
        {step === 'projects' && (
          <ProjectsStep onBack={() => setStep('connect')} onDone={() => setStep('sync')} />
        )}
        {step === 'sync' && <SyncStep />}
      </div>
    </div>
  )
}

function ConnectStep({ onDone }: { onDone: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const [siteUrl, setSiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await invoke('auth:connect', { siteUrl, email, apiToken })
      await queryClient.invalidateQueries({ queryKey: ['auth'] })
      onDone()
    } catch (err) {
      setError(err instanceof IpcError ? err.message : t.common.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t.onboarding.title}>
      <p className="mb-4 text-sm text-zinc-400">{t.onboarding.subtitle}</p>
      <div className="space-y-3">
        <Input
          label={t.onboarding.siteUrl}
          placeholder={t.onboarding.siteUrlPlaceholder}
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          autoFocus
        />
        <Input
          label={t.onboarding.email}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t.onboarding.apiToken}
          type="password"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          hint={
            <>
              {t.onboarding.tokenHelp}{' '}
              <a
                className="text-indigo-400 hover:underline light:text-indigo-600"
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noreferrer"
              >
                {t.onboarding.tokenLinkLabel}
              </a>
            </>
          }
        />
        {error && <p className="text-sm text-red-400 light:text-red-600">{error}</p>}
        <Button
          className="w-full"
          disabled={busy || !siteUrl || !email || !apiToken}
          onClick={() => void submit()}
        >
          {busy && <Spinner />}
          {busy ? t.onboarding.connecting : t.onboarding.testAndConnect}
        </Button>
      </div>
    </Card>
  )
}

function ProjectsStep({
  onBack,
  onDone
}: {
  onBack: () => void
  onDone: () => void
}): React.JSX.Element {
  const { data, isLoading, isError } = useProjects(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('projects:setSelected', { keys: [...selected] })
      void invoke('sync:run', { full: true })
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t.onboarding.selectProjects}>
      <p className="mb-4 text-sm text-zinc-400">{t.onboarding.selectProjectsSubtitle}</p>
      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Spinner /> {t.onboarding.loadingProjects}
        </p>
      )}
      {isError && <p className="text-sm text-red-400 light:text-red-600">{t.common.error}</p>}
      {data && data.projects.length === 0 && (
        <p className="text-sm text-zinc-500">{t.onboarding.noProjects}</p>
      )}
      {data && data.projects.length > 0 && (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {data.projects.map((p) => (
            <label
              key={p.key}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={selected.has(p.key)}
                onChange={() => toggle(p.key)}
              />
              <span className="text-sm font-medium text-zinc-200">{p.key}</span>
              <span className="truncate text-sm text-zinc-400">{p.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t.onboarding.back}
        </Button>
        <Button disabled={selected.size === 0 || busy} onClick={() => void submit()}>
          {busy && <Spinner />}
          {t.onboarding.continue}
        </Button>
      </div>
    </Card>
  )
}

function SyncStep(): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: status } = useSyncStatus()
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    const off = window.api.on('push:sync-complete', ({ success }) => {
      if (success) setFinished(true)
    })
    return off
  }, [])

  const progress = status?.progress
  const phaseLabel = progress ? (t.sync.phases[progress.phase] ?? progress.phase) : null

  return (
    <Card title={t.onboarding.initialSync}>
      <p className="mb-4 text-sm text-zinc-400">{t.onboarding.initialSyncSubtitle}</p>
      <div className="flex items-center gap-3 py-4">
        {finished ? (
          <>
            <CheckCircle2 className="text-green-400 light:text-green-600" size={20} />
            <span className="text-sm text-zinc-200">{t.onboarding.syncDone}</span>
          </>
        ) : (
          <>
            <Spinner className="text-indigo-400 light:text-indigo-600" />
            <span className="text-sm text-zinc-300">
              {phaseLabel ?? t.sync.syncing}
              {progress && progress.done > 0 && (
                <span className="text-zinc-500">
                  {' '}
                  ({progress.done}
                  {progress.total !== null ? `/${progress.total}` : ''})
                </span>
              )}
            </span>
          </>
        )}
      </div>
      {status?.lastError && (
        <p className="mb-2 text-sm text-red-400 light:text-red-600">{status.lastError}</p>
      )}
      <Button
        className="w-full"
        disabled={!finished && !status?.lastError}
        onClick={() => {
          void queryClient.invalidateQueries()
          void navigate('/')
        }}
      >
        {t.onboarding.start}
      </Button>
    </Card>
  )
}
