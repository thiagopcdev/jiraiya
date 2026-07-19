import { format } from 'date-fns'
import type { VelocitySummary, VelocitySprint } from '@shared/domain'

/** Maior prefixo comum a todos os nomes (usado pra encurtar labels tipo "Sprint 42"). */
function commonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let prefix = names[0]
  for (const name of names.slice(1)) {
    while (prefix.length > 0 && !name.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
    if (!prefix) return ''
  }
  return prefix
}

function sprintLabel(sprint: VelocitySprint, prefix: string): string {
  if (sprint.name) {
    const stripped = sprint.name.slice(prefix.length).trim()
    const label = stripped.length > 0 ? stripped : sprint.name.trim()
    return label.length > 10 ? `${label.slice(0, 10)}…` : label
  }
  return format(new Date(sprint.startDate), 'dd/MM')
}

/**
 * Entregas por sprint (velocity) em SVG leve, no estilo do BurndownChart:
 * barras = pontos do time, linha+marcadores = pontos do usuário, mesma
 * escala Y (baseada no maior teamPoints entre as sprints exibidas).
 */
export function VelocityChart({
  velocity
}: {
  velocity: VelocitySummary
}): React.JSX.Element | null {
  const { sprints } = velocity
  if (sprints.length === 0) return null

  const W = 600
  const H = 160
  const padL = 28
  const padR = 12
  const padT = 22
  const padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const n = sprints.length
  const slotW = plotW / n
  const maxTeam = Math.max(1, ...sprints.map((s) => s.teamPoints))

  const cx = (i: number): number => padL + slotW * (i + 0.5)
  const y = (value: number): number => padT + (1 - value / maxTeam) * plotH

  const names = sprints.map((s) => s.name).filter((name): name is string => !!name)
  const prefix = commonPrefix(names)

  const barW = slotW * 0.6

  const linePoints = sprints
    .map((s, i) => `${cx(i).toFixed(1)},${y(s.myPoints).toFixed(1)}`)
    .join(' ')

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-zinc-600" /> Time
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded bg-indigo-400" /> Você
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Entregas por sprint: pontos do time e pontos concluídos por você"
      >
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#3f3f46" strokeWidth="1" />
        <line x1={padL} y1={padT} x2={padL} y2={y(0)} stroke="#3f3f46" strokeWidth="1" />

        <text x={padL - 6} y={padT + 4} fontSize="10" fill="#71717a" textAnchor="end">
          {maxTeam}
        </text>
        <text x={padL - 6} y={y(0) + 4} fontSize="10" fill="#71717a" textAnchor="end">
          0
        </text>

        {sprints.map((s, i) => {
          const x0 = cx(i) - barW / 2
          const barTop = y(s.teamPoints)
          const barH = y(0) - barTop
          const isActive = s.state === 'active'
          const title = `${s.name ?? sprintLabel(s, prefix)}\nTime: ${s.teamPoints} SP · ${s.teamCount} cards\nVocê: ${s.myPoints} SP · ${s.myCount} cards`
          return (
            <g key={s.sprintJiraId}>
              <title>{title}</title>
              <rect
                x={x0}
                y={barTop}
                width={barW}
                height={Math.max(0, barH)}
                fill={isActive ? '#6366f1' : '#52525b'}
              />
              <text
                x={cx(i)}
                y={H - 6}
                fontSize="10"
                fill={isActive ? '#a5b4fc' : '#71717a'}
                textAnchor="middle"
              >
                {sprintLabel(s, prefix)}
              </text>
            </g>
          )
        })}

        <polyline points={linePoints} fill="none" stroke="#818cf8" strokeWidth="1.5" />
        {sprints.map((s, i) => (
          <g key={`marker-${s.sprintJiraId}`}>
            <title>{`${s.name ?? sprintLabel(s, prefix)}\nVocê: ${s.myPoints} SP · ${s.myCount} cards`}</title>
            <circle cx={cx(i)} cy={y(s.myPoints)} r="3" fill="#818cf8" />
          </g>
        ))}
      </svg>
    </div>
  )
}
