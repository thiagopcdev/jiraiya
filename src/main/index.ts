import { app, shell, BrowserWindow } from 'electron'
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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = openDb()
  ctx = new AppContext(db)
  ctx.scheduler = new SyncScheduler({
    db,
    getClient: () => ctx.getClient(),
    onProgress: (p) => ctx.push('push:sync-progress', p),
    onComplete: (r) => ctx.push('push:sync-complete', r)
  })

  registerAuthHandlers(ctx)
  registerProjectHandlers(ctx)
  registerSyncHandlers(ctx)
  registerPrefsHandlers(ctx)
  registerAlertHandlers(ctx)
  registerIssueHandlers(ctx)
  registerSummaryHandlers(ctx)

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
