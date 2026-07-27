import type { ThemePref } from '@shared/domain'

/**
 * Aplicação do tema no renderer: seta data-theme no <html> (o CSS troca a
 * escala de tons por variáveis). Espelho em localStorage para aplicar ANTES
 * do primeiro paint (a janela só aparece no ready-to-show, então sem flash);
 * a pref oficial vem do banco via prefs:get e re-aplica em seguida.
 */

const STORAGE_KEY = 'jiraiya.theme'

let currentPref: ThemePref = 'dark'
let mediaBound = false

/** Resolve a pref para o tema efetivo (função pura — testável). */
export function resolveTheme(pref: ThemePref, systemDark: boolean): 'dark' | 'light' {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function apply(): void {
  document.documentElement.dataset.theme = resolveTheme(currentPref, systemPrefersDark())
}

/** Define a pref (vinda das Configurações/prefs) e aplica; persiste o espelho. */
export function applyThemePref(pref: ThemePref): void {
  currentPref = pref
  localStorage.setItem(STORAGE_KEY, pref)
  apply()
}

/** Chamado uma vez no boot do renderer, antes do render do React. */
export function bootTheme(): void {
  const stored = localStorage.getItem(STORAGE_KEY)
  currentPref = stored === 'light' || stored === 'system' ? stored : 'dark'
  apply()
  if (!mediaBound) {
    mediaBound = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply())
  }
}
