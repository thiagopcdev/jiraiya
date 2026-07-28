import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from '@shared/domain'
import type { Prefs } from '@shared/domain'
import { CURATED_MODELS, DEFAULT_MODELS, modelFor } from './models'

function prefsWith(over: Partial<Prefs>): Prefs {
  return { ...DEFAULT_PREFS, ...over }
}

describe('modelFor', () => {
  it('precedência 1: aiModels[provider][feature] explícito vence tudo', () => {
    const prefs = prefsWith({ aiModels: { gemini: { draft: 'x' } } })
    expect(modelFor('draft', 'gemini', prefs)).toBe('x')
  })

  it('precedência 2 (só claude): sem aiModels, usa pref legado modelSplit', () => {
    const prefs = prefsWith({ modelSplit: 'opus', aiModels: {} })
    expect(modelFor('split', 'claude', prefs)).toBe('opus')
  })

  it('precedência 3: sem nada usa DEFAULT_MODELS[provider][feature] ?? DEFAULT_MODELS[provider].default', () => {
    const prefs = prefsWith({ aiModels: {} })
    const esperado = DEFAULT_MODELS.claude.summaries ?? DEFAULT_MODELS.claude.default
    expect(modelFor('summaries', 'claude', prefs)).toBe(esperado)
  })

  it('gemini não lê os prefs legados model*', () => {
    const prefs = prefsWith({ modelSummaries: 'opus', aiModels: {} })
    const esperado = DEFAULT_MODELS.gemini.summaries ?? DEFAULT_MODELS.gemini.default
    expect(modelFor('summaries', 'gemini', prefs)).toBe(esperado)
    expect(modelFor('summaries', 'gemini', prefs)).not.toBe('opus')
  })

  it('codex não lê os prefs legados model*', () => {
    const prefs = prefsWith({ modelSummaries: 'opus', aiModels: {} })
    const esperado = DEFAULT_MODELS.codex.summaries ?? DEFAULT_MODELS.codex.default
    expect(modelFor('summaries', 'codex', prefs)).toBe(esperado)
    expect(modelFor('summaries', 'codex', prefs)).not.toBe('opus')
  })
})

describe('CURATED_MODELS', () => {
  it('tem entradas não-vazias para claude, gemini e codex', () => {
    expect(CURATED_MODELS.claude.length).toBeGreaterThan(0)
    expect(CURATED_MODELS.gemini.length).toBeGreaterThan(0)
    expect(CURATED_MODELS.codex.length).toBeGreaterThan(0)
  })
})
