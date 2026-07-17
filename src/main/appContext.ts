import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { JiraClient } from './jira/client'
import { JiraHttp } from './jira/http'
import { getCredential } from './security/credentials'
import { getWorkspaceRow } from './db/repos/workspace'
import type { SyncScheduler } from './sync/scheduler'
import type { PushChannel, PushEvents } from '@shared/ipc-contract'

/** Estado compartilhado do processo main. */
export class AppContext {
  mainWindow: BrowserWindow | null = null
  scheduler: SyncScheduler | null = null
  private cachedClient: JiraClient | null = null

  constructor(public readonly db: Database.Database) {}

  push<P extends PushChannel>(channel: P, payload: PushEvents[P]): void {
    this.mainWindow?.webContents.send(channel, payload)
  }

  /** Client do Jira a partir do workspace + credencial persistidos. */
  getClient(): JiraClient | null {
    if (this.cachedClient) return this.cachedClient
    const workspace = getWorkspaceRow(this.db)
    if (!workspace) return null
    const token = getCredential(this.db, workspace.id, 'jira_api_token')
    if (!token) return null
    const http = new JiraHttp({
      siteUrl: workspace.site_url,
      email: workspace.email,
      apiToken: token,
      onAuthError: () => this.push('push:auth-invalid', {})
    })
    this.cachedClient = new JiraClient(http)
    return this.cachedClient
  }

  invalidateClient(): void {
    this.cachedClient = null
  }
}
