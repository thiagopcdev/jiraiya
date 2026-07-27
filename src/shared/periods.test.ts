import { describe, expect, it } from 'vitest'
import { standupReference } from './periods'

describe('standupReference', () => {
  it('dia útil comum (quarta) usa ontem literal', () => {
    const ref = standupReference(new Date('2026-07-22T10:00:00')) // quarta
    expect(ref.period).toEqual({ type: 'yesterday' })
    expect(ref.label).toBe('ontem')
  })

  it('sábado usa ontem literal (sexta é dia útil)', () => {
    const ref = standupReference(new Date('2026-07-25T10:00:00')) // sábado
    expect(ref.period).toEqual({ type: 'yesterday' })
    expect(ref.label).toBe('ontem')
  })

  it('domingo recua até a sexta', () => {
    const ref = standupReference(new Date('2026-07-26T10:00:00')) // domingo
    expect(ref.period.type).toBe('custom')
    expect(ref.period.start).toContain('2026-07-24') // sexta
    expect(ref.period.end).toContain('2026-07-25')
    expect(ref.label).toBe('na sexta-feira')
  })

  it('segunda recua até a sexta', () => {
    const ref = standupReference(new Date('2026-07-27T09:00:00')) // segunda
    expect(ref.period.type).toBe('custom')
    expect(ref.period.start).toContain('2026-07-24') // sexta
    expect(ref.period.end).toContain('2026-07-25')
    expect(ref.label).toBe('na sexta-feira')
  })

  it('range custom cobre exatamente um dia [início da sexta, início do sábado)', () => {
    const ref = standupReference(new Date('2026-07-27T09:00:00'))
    const start = new Date(ref.period.start!)
    const end = new Date(ref.period.end!)
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(start.getHours()).toBe(0)
  })
})
