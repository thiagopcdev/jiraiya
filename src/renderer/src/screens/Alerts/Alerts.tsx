import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertOctagon, AlertTriangle, ExternalLink, Eye, Info, X } from 'lucide-react'
import type { Alert, AlertSeverity } from '@shared/domain'
import { invoke } from '../../api/client'
import { useAlerts } from '../../api/hooks'
import { Card, CollapsedStats, ScreenHeader, Spinner } from '../../components/ui'
import { IssueRow } from '../../components/IssueRow'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'

const SEVERITIES: AlertSeverity[] = ['critical', 'warning', 'info']

/**
 * Uma entrada por severidade: rótulo do cartão, plural da linha colapsada e as
 * três cores (ícone, bolinha da linha e pílula do contador). As classes ficam
 * escritas por extenso porque o Tailwind não enxerga classe montada em runtime.
 */
const severityMeta: Record<
  AlertSeverity,
  {
    label: string
    plural: string
    icon: typeof Info
    iconClass: string
    dotClass: string
    pillClass: string
  }
> = {
  critical: {
    label: 'Críticos',
    plural: 'críticos',
    icon: AlertOctagon,
    iconClass: 'text-red-400 light:text-red-600',
    dotClass: 'bg-red-400 light:bg-red-600',
    pillClass: 'bg-red-600/16 text-red-400 light:text-red-600'
  },
  warning: {
    label: 'Atenção',
    plural: 'de atenção',
    icon: AlertTriangle,
    iconClass: 'text-amber-400 light:text-amber-600',
    dotClass: 'bg-amber-400 light:bg-amber-600',
    pillClass: 'bg-amber-600/16 text-amber-400 light:text-amber-600'
  },
  info: {
    label: 'Informativos',
    plural: 'informativos',
    icon: Info,
    iconClass: 'text-blue-400 light:text-blue-600',
    dotClass: 'bg-blue-400 light:bg-blue-600',
    pillClass: 'bg-blue-600/16 text-blue-400 light:text-blue-600'
  }
}

export default function Alerts(): React.JSX.Element {
  const { data, isLoading } = useAlerts()
  const alerts = data?.alerts ?? []
  const groups = SEVERITIES.map((sev) => ({
    sev,
    items: alerts.filter((a) => a.severity === sev)
  }))
  const allClear = alerts.length === 0

  const { data: watchData, isLoading: watchLoading } = useQuery({
    queryKey: ['watch-list'],
    queryFn: () => invoke('watch:list', {})
  })
  const watched = watchData?.issues ?? []

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Alertas"
        context={
          alerts.length > 0
            ? groups.map((g) => `${g.items.length} ${severityMeta[g.sev].plural}`).join(' · ')
            : undefined
        }
      />
      <div className="flex-1 overflow-y-auto px-6 py-[18px]">
        <div className="flex max-w-[860px] flex-col gap-3.5">
          {isLoading && <Spinner className="text-zinc-500" />}

          {!isLoading && allClear && (
            <CollapsedStats
              items={SEVERITIES.map((sev) => ({ label: severityMeta[sev].label, count: 0 }))}
              allClearLabel="Nenhum alerta ativo. Tudo em ordem."
            />
          )}

          {!isLoading &&
            !allClear &&
            groups.map(({ sev, items }) =>
              items.length === 0 ? (
                <CollapsedSeverity key={sev} severity={sev} count={0} />
              ) : (
                <AlertGroup key={sev} severity={sev} items={items} />
              )
            )}

          {/* seguir nada é o estado normal de quem não usa o recurso: linha de
              ~26px, não cartão com empty state (regra 3) */}
          {!watchLoading && watched.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-[12.5px] text-zinc-400">
              <Eye size={15} className="text-zinc-400" />
              <span className="font-semibold text-zinc-200">Seguindo 0</span>
              <span>marque um card com o olho na gaveta para acompanhá-lo aqui</span>
            </div>
          ) : (
            <Card
              title={
                <span className="flex items-center gap-2.5">
                  <Eye size={15} className="text-zinc-400" />
                  Seguindo
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-zinc-400">
                    {watched.length}
                  </span>
                </span>
              }
              actions={
                <span className="text-[11.5px] text-zinc-500">
                  cards que você marcou com o olho na gaveta
                </span>
              }
              bodyClassName={watchLoading ? 'p-4' : 'px-4 pt-0.5 pb-2.5'}
            >
              {watchLoading ? (
                <Spinner className="text-zinc-500" />
              ) : (
                <div className="flex flex-col divide-y divide-zinc-800/70">
                  {watched.map((issue) => (
                    <IssueRow key={issue.key} issue={issue} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/** Severidade sem item nenhum não vira cartão (regra 3): é uma linha de ~26px. */
function CollapsedSeverity({
  severity,
  count
}: {
  severity: AlertSeverity
  count: number
}): React.JSX.Element {
  const meta = severityMeta[severity]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-[12.5px] text-zinc-400">
      <Icon size={15} className={meta.iconClass} />
      <span className="font-semibold text-zinc-200">
        {count} {meta.plural}
      </span>
      <span>nada por aqui</span>
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
    <Card
      title={
        <span className="flex items-center gap-2.5">
          <Icon size={15} className={meta.iconClass} />
          {meta.label}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.pillClass}`}>
            {items.length}
          </span>
        </span>
      }
      bodyClassName="px-4 pt-0.5 pb-2.5"
    >
      <div className="flex flex-col divide-y divide-zinc-800/70">
        {items.map((alert) => (
          <div key={alert.id} className="flex items-center gap-3 py-2.5">
            <span className={`size-1.5 shrink-0 rounded-full ${meta.dotClass}`} />
            <button
              className="-mx-1.5 min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-zinc-800/60 disabled:opacity-50 disabled:hover:bg-transparent"
              disabled={!alert.issueKey}
              onClick={() => alert.issueKey && openIssue(alert.issueKey)}
              title={alert.issueKey ? `Abrir ${alert.issueKey}` : undefined}
            >
              <div className="truncate text-[13.5px] text-zinc-200">{alert.message}</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-500">
                detectado{' '}
                {formatDistanceToNow(new Date(alert.firstDetectedAt), {
                  addSuffix: true,
                  locale: ptBR
                })}
              </div>
            </button>
            {alert.issueKey && (
              <button
                className="shrink-0 rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() =>
                  alert.issueKey && void invoke('shell:openIssue', { issueKey: alert.issueKey })
                }
                title={`Abrir ${alert.issueKey} no Jira`}
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              className="shrink-0 rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => void dismiss(alert.id)}
              title={t.common.dismiss}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}
