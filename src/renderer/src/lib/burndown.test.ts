import { describe, expect, it } from 'vitest'
import { computeBurndown } from './burndown'

// sprint de 10 dias: 08/07 -> 18/07; "hoje" = 12/07
const START = '2026-07-08T03:00:00.000Z'
const END = '2026-07-18T03:00:00.000Z'
const NOW = new Date('2026-07-12T15:00:00')

describe('computeBurndown', () => {
  const issues = [
    { storyPoints: 5, resolvedAt: '2026-07-09T18:00:00.000Z' },
    { storyPoints: 3, resolvedAt: '2026-07-11T12:00:00.000Z' },
    { storyPoints: 2, resolvedAt: null },
    { storyPoints: null, resolvedAt: null }
  ]

  it('escopo, sem estimativa e dias totais', () => {
    const b = computeBurndown(issues, START, END, NOW)
    expect(b.scope).toBe(10)
    expect(b.unestimatedCount).toBe(1)
    expect(b.totalDays).toBe(10)
  })

  it('linha real desce conforme resoluções e para em hoje', () => {
    const b = computeBurndown(issues, START, END, NOW)
    // 08 a 12/07 = 5 pontos na linha
    expect(b.actual).toHaveLength(5)
    const remainings = b.actual.map((p) => p.remaining)
    // dia 08: nada resolvido -> 10; dia 09: -5 -> 5; dia 10: 5; dia 11: -3 -> 2; dia 12: 2
    expect(remainings).toEqual([10, 5, 5, 2, 2])
  })

  it('issue resolvida antes da sprint já sai do primeiro dia', () => {
    const b = computeBurndown(
      [
        { storyPoints: 4, resolvedAt: '2026-07-01T10:00:00.000Z' },
        { storyPoints: 6, resolvedAt: null }
      ],
      START,
      END,
      NOW
    )
    expect(b.scope).toBe(10)
    expect(b.actual[0].remaining).toBe(6)
  })

  it('depois do fim da sprint a linha para no fim (não em hoje)', () => {
    const b = computeBurndown(issues, START, END, new Date('2026-07-25T12:00:00'))
    expect(b.actual.length).toBe(11) // 08..18 inclusive
  })

  it('sprint sem issues não explode', () => {
    const b = computeBurndown([], START, END, NOW)
    expect(b.scope).toBe(0)
    expect(b.actual.every((p) => p.remaining === 0)).toBe(true)
  })
})
