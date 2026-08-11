import { handle } from '../registry'
import type { AppContext } from '../../appContext'

export function registerSyncHandlers(ctx: AppContext): void {
  handle('sync:run', ({ full }) => {
    // dispara em background; progresso via canais push
    void ctx.scheduler?.trigger({ full })
    return { started: true }
  })

  handle('sync:status', () => {
    return (
      ctx.scheduler?.status() ?? {
        running: false,
        lastSuccessAt: null,
        lastError: null,
        progress: null,
        // sem agendador não há próximo sync agendado para anunciar
        nextRunAt: null
      }
    )
  })
}
