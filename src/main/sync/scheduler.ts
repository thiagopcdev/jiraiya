import type Database from 'better-sqlite3'
import { runSync, type AfterSyncInfo, type SyncProgress } from './engine'
import { JiraClient } from '../jira/client'
import { getPrefs, getLastSuccessAt } from '../db/repos/misc'
import { getWorkspaceRow } from '../db/repos/workspace'
import type { SyncStatus } from '@shared/domain'

export interface SchedulerDeps {
  db: Database.Database
  /** Constrói o client sob demanda (credenciais podem mudar). Null se desconectado. */
  getClient: () => JiraClient | null
  onProgress: (p: SyncProgress) => void
  onComplete: (result: { success: boolean; error: string | null }) => void
  onAfterSync?: (info: AfterSyncInfo) => void
  /** roda antes do engine (drena a fila offline) — falha aqui não derruba o sync */
  onBeforeSync?: () => Promise<void>
}

/** Agenda o sync: no boot, a cada N minutos e sob demanda. Nunca roda 2 em paralelo. */
export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private lastError: string | null = null
  private lastProgress: SyncProgress | null = null

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    this.reschedule()
    // sync inicial levemente adiado para não competir com o boot da janela
    setTimeout(() => void this.trigger(), 3000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  reschedule(): void {
    this.stop()
    const minutes = getPrefs(this.deps.db).syncIntervalMinutes
    this.timer = setInterval(() => void this.trigger(), minutes * 60 * 1000)
  }

  status(): SyncStatus {
    const workspace = getWorkspaceRow(this.deps.db)
    return {
      running: this.running,
      lastSuccessAt: workspace ? getLastSuccessAt(this.deps.db, workspace.id) : null,
      lastError: this.lastError,
      progress: this.running ? this.lastProgress : null
    }
  }

  async trigger(opts: { full?: boolean } = {}): Promise<boolean> {
    if (this.running) return false
    const workspace = getWorkspaceRow(this.deps.db)
    const client = this.deps.getClient()
    if (!workspace || !client) return false

    this.running = true
    this.lastError = null
    this.lastProgress = null
    try {
      if (this.deps.onBeforeSync) {
        try {
          await this.deps.onBeforeSync()
        } catch (err) {
          console.error('[sync] onBeforeSync falhou', err)
        }
      }
      await runSync(
        {
          db: this.deps.db,
          client,
          workspace,
          onProgress: (p) => {
            this.lastProgress = p
            this.deps.onProgress(p)
          },
          onAfterSync: this.deps.onAfterSync
        },
        opts
      )
      this.deps.onComplete({ success: true, error: null })
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.deps.onComplete({ success: false, error: this.lastError })
      return false
    } finally {
      this.running = false
    }
  }
}
