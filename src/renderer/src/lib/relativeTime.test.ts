import { describe, expect, it } from 'vitest'
import { compactAgo, compactUntil } from './relativeTime'

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

describe('compactUntil', () => {
  const until = (ms: number): string => new Date(now.getTime() + ms).toISOString()

  it('segundos', () => {
    expect(compactUntil(until(45_000), now)).toBe('em 45 s')
  })
  it('minutos', () => {
    expect(compactUntil(until(6 * 60_000), now)).toBe('em 6 min')
    expect(compactUntil(until(59 * 60_000 + 59_000), now)).toBe('em 59 min')
  })
  it('horas e dias', () => {
    expect(compactUntil(until(2 * 3600_000), now)).toBe('em 2 h')
    expect(compactUntil(until(3 * 86_400_000), now)).toBe('em 3 d')
  })
  it('prazo vencido não conta negativo nem diz "em 0 s"', () => {
    expect(compactUntil(until(0), now)).toBe('a qualquer momento')
    expect(compactUntil(until(-90_000), now)).toBe('a qualquer momento')
  })
})
