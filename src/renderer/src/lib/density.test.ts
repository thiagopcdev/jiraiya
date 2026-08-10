// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyDensityPref, bootDensity } from './density'

describe('applyDensityPref / bootDensity', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.density
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applyDensityPref seta data-density no html e persiste em localStorage', () => {
    applyDensityPref('compact')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(localStorage.getItem('jiraiya.density')).toBe('compact')
  })

  it('applyDensityPref com "comfortable" também persiste e aplica', () => {
    applyDensityPref('compact')
    applyDensityPref('comfortable')
    expect(document.documentElement.dataset.density).toBe('comfortable')
    expect(localStorage.getItem('jiraiya.density')).toBe('comfortable')
  })

  it('bootDensity sem nada salvo cai no padrão comfortable', () => {
    bootDensity()
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('bootDensity lê a pref espelhada do localStorage', () => {
    localStorage.setItem('jiraiya.density', 'compact')
    bootDensity()
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  it('bootDensity ignora valor inválido persistido e usa comfortable', () => {
    localStorage.setItem('jiraiya.density', 'lixo-inválido')
    bootDensity()
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })
})
