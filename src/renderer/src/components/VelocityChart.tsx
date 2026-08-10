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
 * (marca, na base) + o restante do time (neutro) somam o total da sprint.
 * Uma escala só (SP), total rotulado no topo de cada barra.
 *
 * O viewBox é estreito (340) de propósito: o gráfico mora no trilho de 380px
 * da tela Time, então uma moldura larga seria reduzida pelo `w-full` e os
 * rótulos de 10px virariam 6px ilegíveis. Paleta validada p/ CVD/contraste via
 * var(--chart-accent) você · var(--chart-muted) resto neutro (ajustam sozinhas
 * por tema), topo arredondado e gap de 2px entre segmentos.
 */
export function VelocityChart({
  velocity
}: {
  velocity: VelocitySummary
}): React.JSX.Element | null {
  const { sprints } = velocity
  if (sprints.length === 0) return null

  const W = 340
  const H = 150
  const padL = 6
  const padR = 6
  const padT = 20
  const padB = 20
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const n = sprints.length
  const slotW = plotW / n
  const maxTeam = Math.max(1, ...sprints.map((s) => s.teamPoints))

  const cx = (i: number): number => padL + slotW * (i + 0.5)
  const y = (value: number): number => padT + (1 - value / maxTeam) * plotH

  const names = sprints.map((s) => s.name).filter((name): name is string => !!name)
  const prefix = commonPrefix(names)

  const barW = Math.min(30, slotW * 0.72)

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3 text-[10.5px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-indigo-400" /> Você
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
          className="stroke-zinc-800"
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
                <rect
                  x={x0}
                  y={mineTop}
                  width={barW}
                  height={mineH}
                  // só arredonda o topo quando a sua fatia É o topo da barra
                  rx={rest > 0 ? 0 : 4}
                  fill="var(--chart-accent)"
                />
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
                y={H - 5}
                fontSize="10"
                fontWeight={isActive ? 700 : 400}
                className={isActive ? 'fill-indigo-400' : 'fill-zinc-500'}
                textAnchor="middle"
              >
                {sprintLabel(s, prefix)}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 text-[10.5px] leading-snug text-zinc-600">
        Rótulo: seus SP / total da sprint — a base da barra é a sua parte. A sprint ativa fica
        destacada no rótulo.
      </p>
    </div>
  )
}
