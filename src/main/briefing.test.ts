import { describe, expect, it, vi } from 'vitest'

// briefing.ts importa 'electron'. Sob ELECTRON_RUN_AS_NODE isso pode nem
// resolver como módulo — mockamos antes do import para garantir.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/fake') }
}))

const { shouldRunBriefing } = await import('./briefing')

describe('shouldRunBriefing', () => {
  const now = new Date('2026-07-23T09:00:00')
  const todayLocal = now.toLocaleDateString('sv')
  const yesterdayLocal = new Date(now.getTime() - 24 * 3600 * 1000).toLocaleDateString('sv')

  it('lastRunDate null → true', () => {
    expect(shouldRunBriefing(null, now)).toBe(true)
  })

  it('lastRunDate igual à data local de now → false', () => {
    expect(shouldRunBriefing(todayLocal, now)).toBe(false)
  })

  it('lastRunDate diferente da data local de now → true', () => {
    expect(shouldRunBriefing(yesterdayLocal, now)).toBe(true)
  })
})
