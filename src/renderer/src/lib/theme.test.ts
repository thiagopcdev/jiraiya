// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemePref, bootTheme, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('dark e light são diretos, independem do sistema', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('system segue o modo do SO', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

/** matchMedia falso controlável — simula o SO em modo claro ou escuro. */
function mockMatchMedia(systemDark: boolean): {
  restore: () => void
  changeHandlers: Array<(e: { matches: boolean }) => void>
} {
  const changeHandlers: Array<(e: { matches: boolean }) => void> = []
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: systemDark,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) => {
      changeHandlers.push(cb)
    },
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
  return {
    restore: () => {
      window.matchMedia = original
    },
    changeHandlers
  }
}

describe('applyThemePref / bootTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applyThemePref seta data-theme no html e persiste em localStorage', () => {
    const { restore } = mockMatchMedia(false)
    applyThemePref('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('jiraiya.theme')).toBe('light')
    restore()
  })

  it('applyThemePref com pref "system" resolve pelo SO', () => {
    const { restore } = mockMatchMedia(true)
    applyThemePref('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    restore()
  })

  it('bootTheme sem nada salvo cai no padrão dark', () => {
    const { restore } = mockMatchMedia(false)
    bootTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    restore()
  })

  it('bootTheme lê a pref espelhada do localStorage', () => {
    localStorage.setItem('jiraiya.theme', 'light')
    const { restore } = mockMatchMedia(true)
    bootTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    restore()
  })

  it('bootTheme ignora valor inválido persistido e usa dark', () => {
    localStorage.setItem('jiraiya.theme', 'roxo-inválido')
    const { restore } = mockMatchMedia(false)
    bootTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    restore()
  })
})
