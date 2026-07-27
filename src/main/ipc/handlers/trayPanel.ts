import { handle } from '../registry'
import type { AppContext } from '../../appContext'

/**
 * Handlers do popover do tray. Diferente dos outros register*, recebe deps
 * porque quem sabe mostrar/recriar a janela principal é o index.ts.
 */
export function registerTrayPanelHandlers(ctx: AppContext, deps: { showWindow: () => void }): void {
  handle('app:focusIssue', ({ key }) => {
    deps.showWindow()
    ctx.push('push:open-issue', { key })
    return { ok: true }
  })

  handle('app:show', () => {
    deps.showWindow()
    return { ok: true }
  })
}
