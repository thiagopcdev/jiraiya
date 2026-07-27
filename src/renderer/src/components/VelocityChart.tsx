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
 * Entregas por sprint (velocity): barra EMPILHADA por sprint — sua fatia
 * (índigo, na base) + o restante do time (neutro) somam o total da sprint.
 * Uma escala só (SP), total rotulado no topo de cada barra, sua fatia
 * rotulada quando cabe. Paleta validada p/ CVD/contraste via
 * var(--chart-accent) você · var(--chart-muted) resto neutro (ajustam sozinhas
 * por tema), gap de 2px entre segmentos.
 */
export function VelocityChart({
  velocity
}: {
  velocity: VelocitySummary
}): React.JSX.Element | null {
  const { sprints } = velocity
  if (sprints.length === 0) return null

  const W = 600
  const H = 170
  const padL = 28
  const padR = 12
  const padT = 24
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

  const barW = Math.min(44, slotW * 0.6)

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-indigo-400 light:bg-indigo-600" /> Você
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-zinc-500" /> Restante do time
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Entregas por sprint: sua fatia e o total do time em story points"
      >
        <line
          x1={padL}
          y1={y(0)}
          x2={W - padR}
          y2={y(0)}
          className="stroke-zinc-700"
          strokeWidth="1"
        />

        {sprints.map((s, i) => {
          const x0 = cx(i) - barW / 2
          const isActive = s.state === 'active'
          const total = s.teamPoints
          const mine = Math.min(s.myPoints, total)
          const rest = total - mine

          const totalTop = y(total)
          const mineTop = y(mine)
          const mineH = Math.max(0, y(0) - mineTop)
          // resto neutro em cima da sua fatia, com gap de 2px entre segmentos
          const restH = Math.max(0, mineTop - totalTop - (mine > 0 && rest > 0 ? 2 : 0))

          const title = `${s.name ?? sprintLabel(s, prefix)}${isActive ? ' (ativa)' : ''}\nVocê: ${s.myPoints} SP · ${s.myCount} cards\nTime: ${s.teamPoints} SP · ${s.teamCount} cards`
          return (
            <g key={s.sprintJiraId}>
              <title>{title}</title>
              {rest > 0 && (
                <rect
                  x={x0}
                  y={totalTop}
                  width={barW}
                  height={restH}
                  rx="4"
                  fill="var(--chart-muted)"
                />
              )}
              {mine > 0 && (
                <rect x={x0} y={mineTop} width={barW} height={mineH} fill="var(--chart-accent)" />
              )}
              {total > 0 && (
                // sempre visível: seus pontos / total da sprint
                <text x={cx(i)} y={totalTop - 5} fontSize="10" textAnchor="middle">
                  <tspan fill="var(--chart-accent)" fontWeight="600">
                    {s.myPoints}
                  </tspan>
                  <tspan className="fill-zinc-500">/</tspan>
                  <tspan className="fill-zinc-400">{total}</tspan>
                </text>
              )}
              <text
                x={cx(i)}
                y={H - 6}
                fontSize="10"
                className={isActive ? 'fill-zinc-200' : 'fill-zinc-500'}
                textAnchor="middle"
              >
                {sprintLabel(s, prefix)}
                {isActive ? ' •' : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-xs text-zinc-600">
        Rótulo: <span className="font-semibold text-indigo-300 light:text-indigo-600">seus SP</span>
        <span> / total da sprint</span> — a base índigo da barra é a sua parte. • = sprint ativa.
      </p>
    </div>
  )
}
