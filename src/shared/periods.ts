export type PeriodType = 'today' | 'yesterday' | '7d' | '30d' | 'sprint' | 'custom'

export interface Period {
  type: PeriodType
  /** ISO datetime inclusivo (usado quando type === 'custom') */
  start?: string
  /** ISO datetime exclusivo (usado quando type === 'custom') */
  end?: string
}

export interface PeriodRange {
  /** ISO datetime inclusivo */
  start: string
  /** ISO datetime exclusivo */
  end: string
  label: string
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

/**
 * Resolve um Period em um range concreto [start, end).
 * 'sprint' precisa das datas da sprint ativa — se ausentes, cai em 14 dias.
 */
export function resolvePeriod(
  period: Period,
  now: Date = new Date(),
  sprint?: { startDate: string | null; endDate: string | null; name?: string | null }
): PeriodRange {
  const today = startOfDay(now)
  switch (period.type) {
    case 'today':
      return { start: today.toISOString(), end: addDays(today, 1).toISOString(), label: 'Hoje' }
    case 'yesterday':
      return { start: addDays(today, -1).toISOString(), end: today.toISOString(), label: 'Ontem' }
    case '7d':
      return {
        start: addDays(today, -6).toISOString(),
        end: addDays(today, 1).toISOString(),
        label: 'Últimos 7 dias'
      }
    case '30d':
      return {
        start: addDays(today, -29).toISOString(),
        end: addDays(today, 1).toISOString(),
        label: 'Últimos 30 dias'
      }
    case 'sprint': {
      if (sprint?.startDate) {
        return {
          start: sprint.startDate,
          end: sprint.endDate ?? addDays(today, 1).toISOString(),
          label: sprint.name ? `Sprint ${sprint.name}` : 'Sprint atual'
        }
      }
      return {
        start: addDays(today, -13).toISOString(),
        end: addDays(today, 1).toISOString(),
        label: 'Sprint atual'
      }
    }
    case 'custom':
      return {
        start: period.start ?? today.toISOString(),
        end: period.end ?? addDays(today, 1).toISOString(),
        label: 'Período personalizado'
      }
  }
}
