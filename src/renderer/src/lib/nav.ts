/**
 * Estado do trilho da nav (M2 do handoff do menu): recolhido (56px, só ícones)
 * ou fixado aberto (216px). É preferência de janela, não de conta — mora só no
 * cliente, no mesmo padrão de lib/theme.ts: localStorage é a fonte da verdade e
 * é lido de forma síncrona no primeiro render, sem canal IPC novo.
 */

const STORAGE_KEY = 'jiraiya.navCollapsed'

/** Lê o estado persistido. Default = aberto (só recolhe quem pediu). */
export function readNavCollapsed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1'
}

export function writeNavCollapsed(collapsed: boolean): void {
  localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
}
