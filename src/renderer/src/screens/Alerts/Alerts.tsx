import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertOctagon, AlertTriangle, ExternalLink, Info, X } from 'lucide-react'
import type { Alert, AlertSeverity } from '@shared/domain'
import { invoke } from '../../api/client'
import { useAlerts } from '../../api/hooks'
import { Card, EmptyState, Spinner } from '../../components/ui'
import { IssueRow } from '../../components/IssueRow'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'

const severityMeta: Record<AlertSeverity, { label: string; icon: typeof Info; color: string }> = {
  critical: { label: 'Críticos', icon: AlertOctagon, color: 'text-red-400 light:text-red-600' },
  warning: { label: 'Atenção', icon: AlertTriangle, color: 'text-amber-400 light:text-amber-600' },
  info: { label: 'Informativos', icon: Info, color: 'text-blue-400 light:text-blue-600' }
}

export default function Alerts(): React.JSX.Element {
  const { data, isLoading } = useAlerts()
  const alerts = data?.alerts ?? []
  const groups = (['critical', 'warning', 'info'] as AlertSeverity[])
    .map((sev) => ({ sev, items: alerts.filter((a) => a.severity === sev) }))
    .filter((g) => g.items.length > 0)

  const { data: watchData, isLoading: watchLoading } = useQuery({
    queryKey: ['watch-list'],
    queryFn: () => invoke('watch:list', {})
  })
  const watched = watchData?.issues ?? []

  return (
    <div className="p-6">
      <h2 className="mb-5 text-xl font-semibold text-zinc-100">Alertas</h2>
      {isLoading && <Spinner className="text-zinc-500" />}
      {!isLoading && alerts.length === 0 && (
        <EmptyState message="Nenhum alerta ativo. Tudo em ordem." />
      )}
      <div className="space-y-6">
        {groups.map(({ sev, items }) => (
          <AlertGroup key={sev} severity={sev} items={items} />
        ))}
      </div>

      <div className="mt-6">
        <Card title="Seguindo">
          {watchLoading ? (
            <Spinner className="text-zinc-500" />
          ) : watched.length === 0 ? (
            <EmptyState message="Você não segue nenhum card — use o olho na gaveta do card." />
          ) : (
            <div className="space-y-1">
              {watched.map((issue) => (
                <IssueRow key={issue.key} issue={issue} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function AlertGroup({
  severity,
  items
}: {
  severity: AlertSeverity
  items: Alert[]
}): React.JSX.Element {
  const meta = severityMeta[severity]
  const Icon = meta.icon
  const queryClient = useQueryClient()
  const { openIssue } = useIssueDetail()

  const dismiss = async (id: number): Promise<void> => {
    await invoke('alerts:dismiss', { id })
    void queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  return (
    <section>
      <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${meta.color}`}>
        <Icon size={15} />
        {meta.label}
        <span className="text-zinc-500">({items.length})</span>
      </h3>
      <div className="space-y-1">
        {items.map((alert) => (
          <div
            key={alert.id}
            className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2"
          >
            <button
              className="min-w-0 flex-1 text-left"
              disabled={!alert.issueKey}
              onClick={() => alert.issueKey && openIssue(alert.issueKey)}
              title={alert.issueKey ? `Abrir ${alert.issueKey}` : undefined}
            >
              <div className="truncate text-sm text-zinc-200">{alert.message}</div>
              <div className="text-xs text-zinc-500">
                detectado{' '}
                {formatDistanceToNow(new Date(alert.firstDetectedAt), {
                  addSuffix: true,
                  locale: ptBR
                })}
              </div>
            </button>
            {alert.issueKey && (
              <button
                className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() =>
                  alert.issueKey && void invoke('shell:openIssue', { issueKey: alert.issueKey })
                }
                title={`Abrir ${alert.issueKey} no Jira`}
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => void dismiss(alert.id)}
              title={t.common.dismiss}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
