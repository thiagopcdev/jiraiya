import { describe, expect, it } from 'vitest'
import { statusColor } from './statusColor'

describe('statusColor', () => {
  it('done vira verde', () => {
    expect(statusColor('done')).toBe('green')
  })

  it('indeterminate vira azul', () => {
    expect(statusColor('indeterminate')).toBe('blue')
  })

  it('new, null e undefined caem no zinc', () => {
    expect(statusColor('new')).toBe('zinc')
    expect(statusColor(null)).toBe('zinc')
    expect(statusColor(undefined)).toBe('zinc')
  })
})
