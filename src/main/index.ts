import { app, shell, BrowserWindow, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb } from './db'
import { AppContext } from './appContext'
import { SyncScheduler } from './sync/scheduler'
import { registerAuthHandlers } from './ipc/handlers/auth'
import { registerProjectHandlers } from './ipc/handlers/projects'
import { registerSyncHandlers } from './ipc/handlers/sync'
import { registerPrefsHandlers } from './ipc/handlers/prefs'
import { registerAlertHandlers } from './ipc/handlers/alerts'
import { registerIssueHandlers } from './ipc/handlers/issues'
import { registerSummaryHandlers } from './ipc/handlers/summaries'
import { registerTeamHandlers } from './ipc/handlers/team'
import { runAlertEngine } from './alerts/engine'
import { getWorkspaceRow } from './db/repos/workspace'
import { getPrefs, listActiveAlerts } from './db/repos/misc'

let ctx: AppContext

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  ctx.mainWindow = mainWindow
  mainWindow.on('closed', () => {
    if (ctx.mainWindow === mainWindow) ctx.mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('br.com.biud.jiraiya')

  // ícone do dock em dev (no app empacotado o icns já se aplica)
  if (process.platform === 'darwin' && is.dev) {
    app.dock?.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = openDb()
  ctx = new AppContext(db)
  ctx.scheduler = new SyncScheduler({
    db,
    getClient: () => ctx.getClient(),
    onProgress: (p) => ctx.push('push:sync-progress', p),
    onComplete: (r) => ctx.push('push:sync-complete', r),
    onAfterSync: (info) => {
      const workspace = getWorkspaceRow(db)
      if (!workspace) return
      const previous = listActiveAlerts(db, workspace.id)
      const { activeCount } = runAlertEngine(db, workspace.id)
      ctx.push('push:alerts-updated', { count: activeCount })

      const prefs = getPrefs(db)
      const notify = Notification.isSupported()
      const openIssue = (issueKey: string): void => {
        void shell.openExternal(`${workspace.site_url.replace(/\/$/, '')}/browse/${issueKey}`)
      }

      if (prefs.notifyCriticalAlerts && notify) {
        const previousIds = new Set(previous.map((a) => `${a.ruleId}:${a.issueKey}`))
        const fresh = listActiveAlerts(db, workspace.id).filter(
          (a) => a.severity === 'critical' && !previousIds.has(`${a.ruleId}:${a.issueKey}`)
        )
        for (const alert of fresh.slice(0, 3)) {
          const n = new Notification({ title: 'Jiraiya', body: alert.message })
          if (alert.issueKey) n.on('click', () => openIssue(alert.issueKey!))
          n.show()
        }
      }

      if (prefs.notifyAssignedToMe && notify) {
        for (const item of info.assignedToMe.slice(0, 5)) {
          const n = new Notification({
            title: 'Card atribuído a você',
            body: `${item.key} — ${item.summary}`
          })
          n.on('click', () => openIssue(item.key))
          n.show()
        }
      }
    }
  })

  registerAuthHandlers(ctx)
  registerProjectHandlers(ctx)
  registerSyncHandlers(ctx)
  registerPrefsHandlers(ctx)
  registerAlertHandlers(ctx)
  registerIssueHandlers(ctx)
  registerSummaryHandlers(ctx)
  registerTeamHandlers(ctx)

  createWindow()
  ctx.scheduler.start()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
