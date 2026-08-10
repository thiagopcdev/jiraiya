import type { DensityPref } from '@shared/domain'

/**
 * Aplicação da densidade no renderer: seta data-density no <html> (o CSS
 * troca padding/line-height via variante compact). Espelho em localStorage
 * para aplicar ANTES do primeiro paint (a janela só aparece no ready-to-show,
 * então sem flash); a pref oficial vem do banco via prefs:get e re-aplica em
 * seguida. Diferente do tema, não há opção 'system' — não existe densidade
 * do SO para seguir.
 */

const STORAGE_KEY = 'jiraiya.density'

let currentPref: DensityPref = 'comfortable'

function apply(): void {
  document.documentElement.dataset.density = currentPref
}

/** Define a pref (vinda das Configurações/prefs) e aplica; persiste o espelho. */
export function applyDensityPref(pref: DensityPref): void {
  currentPref = pref
  localStorage.setItem(STORAGE_KEY, pref)
  apply()
}

/** Chamado uma vez no boot do renderer, antes do render do React. */
export function bootDensity(): void {
  const stored = localStorage.getItem(STORAGE_KEY)
  currentPref = stored === 'compact' ? stored : 'comfortable'
  apply()
}
