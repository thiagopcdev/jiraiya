import { describe, expect, it } from 'vitest'
import { compactAgo } from './relativeTime'

const now = new Date('2026-07-17T12:00:00Z')
const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString()

describe('compactAgo', () => {
  it('menos de 1 min → agora', () => {
    expect(compactAgo(ago(30_000), now)).toBe('agora')
  })
  it('minutos', () => {
    expect(compactAgo(ago(3 * 60_000), now)).toBe('há 3 min')
    expect(compactAgo(ago(59 * 60_000), now)).toBe('há 59 min')
  })
  it('horas', () => {
    expect(compactAgo(ago(2 * 3600_000), now)).toBe('há 2 h')
  })
  it('dias', () => {
    expect(compactAgo(ago(5 * 86_400_000), now)).toBe('há 5 d')
  })
  it('data no futuro não gera negativo', () => {
    expect(compactAgo(ago(-10_000), now)).toBe('agora')
  })
})
