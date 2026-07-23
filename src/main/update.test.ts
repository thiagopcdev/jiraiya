import { describe, expect, it, vi } from 'vitest'

// update.ts importa 'electron'. Sob ELECTRON_RUN_AS_NODE isso pode nem
// resolver como módulo — mockamos antes do import para garantir.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/fake'), getVersion: vi.fn(() => '1.0.0') }
}))

const { compareVersions } = await import('./update')

describe('compareVersions', () => {
  it('1.2.0 vs 1.1.9 → 1', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
  })

  it('v1.1.0 vs 1.1.0 → 0 (ignora prefixo v)', () => {
    expect(compareVersions('v1.1.0', '1.1.0')).toBe(0)
  })

  it('1.1 vs 1.1.0 → 0 (parte ausente = 0)', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0)
  })

  it('2.0.0 vs 10.0.0 → -1 (comparação numérica, não lexicográfica)', () => {
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1)
  })

  it('1.0.10 vs 1.0.9 → 1 (comparação numérica, não lexicográfica)', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
  })

  it('igualdade exata → 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('inverso de 1.2.0 vs 1.1.9 → -1', () => {
    expect(compareVersions('1.1.9', '1.2.0')).toBe(-1)
  })
})
