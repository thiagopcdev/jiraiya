import { format } from 'date-fns'
import type { Burndown } from '../lib/burndown'

/**
 * Burndown em SVG leve (sem lib): linha ideal tracejada, linha real em
 * degraus por dia e marcador no último ponto.
 */
export function BurndownChart({
  burndown,
  sprintStart,
  sprintEnd
}: {
  burndown: Burndown
  sprintStart: string
  sprintEnd: string
}): React.JSX.Element | null {
  const { scope, actual, totalDays } = burndown
  if (scope <= 0 || actual.length === 0) return null

  const W = 600
  const H = 140
  const padL = 34
  const padR = 12
  const padT = 12
  const padB = 22
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const x = (dayIdx: number): number => padL + (dayIdx / totalDays) * plotW
  const y = (points: number): number => padT + (1 - points / scope) * plotH

  const actualPath = actual
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.remaining).toFixed(1)}`)
    .join(' ')

  const last = actual[actual.length - 1]
  const lastX = x(actual.length - 1)
  const lastY = y(last.remaining)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Burndown da sprint: ${last.remaining} de ${scope} pontos restantes`}
    >
      <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#3f3f46" strokeWidth="1" />
      <line x1={padL} y1={padT} x2={padL} y2={y(0)} stroke="#3f3f46" strokeWidth="1" />

      <line
        x1={x(0)}
        y1={y(scope)}
        x2={x(totalDays)}
        y2={y(0)}
        stroke="#52525b"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />

      <path d={actualPath} fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="4" fill="#818cf8" />
      <text x={lastX + 8} y={lastY - 6} fontSize="11" fill="#a5b4fc">
        {last.remaining} pts
      </text>

      <text x={padL - 6} y={y(scope) + 4} fontSize="10" fill="#71717a" textAnchor="end">
        {scope}
      </text>
      <text x={padL - 6} y={y(0) + 4} fontSize="10" fill="#71717a" textAnchor="end">
        0
      </text>
      <text x={padL} y={H - 6} fontSize="10" fill="#71717a">
        {format(new Date(sprintStart), 'dd/MM')}
      </text>
      <text x={W - padR} y={H - 6} fontSize="10" fill="#71717a" textAnchor="end">
        {format(new Date(sprintEnd), 'dd/MM')}
      </text>
    </svg>
  )
}
