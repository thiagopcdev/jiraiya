/**
 * Burndown da sprint em story points, calculado do cache local.
 * Aproximação honesta: issues removidas da sprint deixam de apontar pra ela,
 * então o escopo histórico se ajusta retroativamente.
 */

export interface BurndownInput {
  storyPoints: number | null
  resolvedAt: string | null
}

export interface BurndownPoint {
  /** dia (00:00 local) */
  dayIso: string
  remaining: number
}

export interface Burndown {
  /** escopo total em pontos (issues sem estimativa contam 0) */
  scope: number
  /** quantas issues não têm estimativa */
  unestimatedCount: number
  /** um ponto por dia, do início da sprint até hoje (inclusive) */
  actual: BurndownPoint[]
  /** total de dias da sprint (para a linha ideal) */
  totalDays: number
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

export function computeBurndown(
  issues: BurndownInput[],
  sprintStart: string,
  sprintEnd: string,
  now: Date = new Date()
): Burndown {
  const scope = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
  const unestimatedCount = issues.filter((i) => i.storyPoints === null).length

  const start = startOfDay(new Date(sprintStart))
  const end = startOfDay(new Date(sprintEnd))
  const today = startOfDay(now)
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000))

  const lastDay = today < end ? today : end
  const actual: BurndownPoint[] = []
  for (let d = new Date(start); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const eod = endOfDay(d).getTime()
    const remaining = issues.reduce((sum, i) => {
      const resolved = i.resolvedAt !== null && new Date(i.resolvedAt).getTime() <= eod
      return sum + (resolved ? 0 : (i.storyPoints ?? 0))
    }, 0)
    actual.push({ dayIso: new Date(d).toISOString(), remaining })
  }

  return { scope, unestimatedCount, actual, totalDays }
}
