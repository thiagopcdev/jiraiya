import { describe, expect, it } from 'vitest'
import { shouldRemind } from './worklogReminder'

describe('shouldRemind', () => {
  it('quarta 17:31 com reminder 17:30 e last=null → true', () => {
    // 2026-07-01 é uma quarta-feira
    const now = new Date(2026, 6, 1, 17, 31)
    expect(shouldRemind(now, '17:30', null)).toBe(true)
  })

  it('quarta 17:29 (antes do horário) → false', () => {
    const now = new Date(2026, 6, 1, 17, 29)
    expect(shouldRemind(now, '17:30', null)).toBe(false)
  })

  it('mesma data em lastReminderDate → false', () => {
    const now = new Date(2026, 6, 1, 17, 31)
    expect(shouldRemind(now, '17:30', '2026-07-01')).toBe(false)
  })

  it('last de ontem → true', () => {
    const now = new Date(2026, 6, 1, 17, 31)
    expect(shouldRemind(now, '17:30', '2026-06-30')).toBe(true)
  })

  it('sábado 18:00 → false (fim de semana)', () => {
    // 2026-07-04 é sábado
    const now = new Date(2026, 6, 4, 18, 0)
    expect(shouldRemind(now, '17:30', null)).toBe(false)
  })

  it('domingo 18:00 → false (fim de semana)', () => {
    // 2026-07-05 é domingo
    const now = new Date(2026, 6, 5, 18, 0)
    expect(shouldRemind(now, '17:30', null)).toBe(false)
  })

  it("reminderTime '09:00' às 09:00 em ponto → true (>=)", () => {
    const now = new Date(2026, 6, 1, 9, 0)
    expect(shouldRemind(now, '09:00', null)).toBe(true)
  })
})
