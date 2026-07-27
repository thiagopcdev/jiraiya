import {
  app,
  shell,
  BrowserWindow,
  Notification,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  screen
} from 'electron'
import type Database from 'better-sqlite3'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDb } from './db'
import { AppContext } from './appContext'
import { SyncScheduler } from './sync/scheduler'
import { registerAuthHandlers } from './ipc/handlers/auth'
import { registerProjectHandlers } from './ipc/handlers/projects'
import { registerSyncHandlers } from './ipc/handlers/sync'
import { registerPrefsHandlers, themeBackgroundColor } from './ipc/handlers/prefs'
import { registerAlertHandlers } from './ipc/handlers/alerts'
import { registerIssueHandlers } from './ipc/handlers/issues'
import { registerSummaryHandlers } from './ipc/handlers/summaries'
import { registerCreateHandlers } from './ipc/handlers/create'
import { registerSplitHandlers } from './ipc/handlers/split'
import { registerTeamHandlers } from './ipc/handlers/team'
import { registerMentionHandlers } from './ipc/handlers/mentions'
import { registerCommentHandlers } from './ipc/handlers/comments'
import { registerBoardHandlers } from './ipc/handlers/board'
import { registerEditHandlers } from './ipc/handlers/edit'
import { registerAttachmentHandlers } from './ipc/handlers/attachments'
import { registerAskHandlers } from './ipc/handlers/ask'
import { registerFilterHandlers } from './ipc/handlers/filters'
import { registerRiskHandlers } from './ipc/handlers/risk'
import { registerUpdateHandlers } from './ipc/handlers/update'
import { registerSprintMoveHandlers } from './ipc/handlers/sprintMove'
import { registerSearchHandlers } from './ipc/handlers/search'
import { registerEpicHandlers } from './ipc/handlers/epics'
import { registerPrHandlers } from './ipc/handlers/prs'
import { registerPolishHandlers } from './ipc/handlers/polish'
import { registerTrendHandlers } from './ipc/handlers/trends'
import { registerWatchHandlers } from './ipc/handlers/watch'
import { registerNotesHandlers } from './ipc/handlers/notes'
import { registerWorklogExportHandlers } from './ipc/handlers/worklogExport'
import { registerTrayPanelHandlers } from './ipc/handlers/trayPanel'
import { startWorklogReminder } from './worklogReminder'
import { clearTempDir } from './attachments/store'
import { runAlertEngine } from './alerts/engine'
import { runWatchEngine } from './watch/engine'
import { getWorkspaceRow } from './db/repos/workspace'
import { getPrefs, listActiveAlerts } from './db/repos/misc'
import { seedMentionHistory, unreadCount } from './db/repos/mentions'
import { runMorningBriefing } from './briefing'
import { checkForUpdate } from './update'
import { claudeStatus } from './summaries/claude'

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
const TRAY_PANEL_WIDTH = 360
const TRAY_PANEL_HEIGHT = 460

let ctx: AppContext
// referência global: sem isso o GC destrói o Tray e o ícone some da barra
let tray: Tray | null = null
// menu do tray guardado à mão: sem setContextMenu (senão o clique esquerdo no
// macOS abriria o menu em vez do popover), abrimos só no right-click
let trayMenu: Menu | null = null
// popover do tray (singleton, criado sob demanda)
let trayPanel: BrowserWindow | null = null
// referência global do timer de verificação de atualização (evita GC/duplicidade)
let updateTimer: NodeJS.Timeout | null = null
// cleanup do lembrete de worklog
let stopWorklogReminder: (() => void) | null = null

/** Dispara a geração do briefing matinal (idempotente pela data local). */
function triggerMorningBriefing(db: Database.Database): void {
  void runMorningBriefing(
    db,
    { push: (s) => ctx.push('push:briefing-ready', s) },
    { claudeAvailable: claudeStatus().available, showWindow: () => showMainWindow() }
  )
}

/** Mostra e foca a janela principal; recria se não existir. */
function showMainWindow(): void {
  if (ctx.mainWindow) {
    if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore()
    ctx.mainWindow.show()
    ctx.mainWindow.focus()
  } else {
    createWindow()
  }
}

/** Cria (sob demanda) a janela do popover do tray, sem exibir. */
function createTrayPanel(): BrowserWindow {
  const panel = new BrowserWindow({
    width: TRAY_PANEL_WIDTH,
    height: TRAY_PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: themeBackgroundColor(getPrefs(ctx.db).theme),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  panel.on('blur', () => panel.hide())
  panel.on('closed', () => {
    if (trayPanel === panel) trayPanel = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void panel.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/tray`)
  } else {
    void panel.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'tray' })
  }

  return panel
}

/** Abre/fecha o popover, posicionado junto ao ícone do tray. */
function toggleTrayPanel(trayRef: Tray): void {
  if (!trayPanel) trayPanel = createTrayPanel()
  const panel = trayPanel

  if (panel.isVisible()) {
    panel.hide()
    return
  }

  const bounds = trayRef.getBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })

  const rawX = Math.round(bounds.x + bounds.width / 2 - TRAY_PANEL_WIDTH / 2)
  const x = Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - TRAY_PANEL_WIDTH))
  const rawY = Math.round(bounds.y + bounds.height + 4)
  const y = Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - TRAY_PANEL_HEIGHT))

  panel.setPosition(x, y, false)
  panel.show()
  panel.focus()
}

/**
 * Atualiza tooltip, menu e badge do tray com as contagens atuais de menções não
 * lidas e alertas ativos. Sem workspace conectado → contagens zeradas.
 */
function updateTray(db: Database.Database): void {
  if (!tray) return
  const trayRef = tray
  const workspace = getWorkspaceRow(db)
  const unread = workspace ? unreadCount(db, workspace.id) : 0
  const alerts = workspace ? listActiveAlerts(db, workspace.id).length : 0

  trayRef.setToolTip('Jiraiya')
  // NÃO usar setContextMenu: no macOS ele intercepta o clique esquerdo e o
  // popover nunca abriria. O menu fica guardado e sai só no right-click.
  trayMenu = Menu.buildFromTemplate([
    { label: 'Abrir Jiraiya', click: () => showMainWindow() },
    { label: 'Abrir painel rápido', click: () => toggleTrayPanel(trayRef) },
    { type: 'separator' },
    { label: `${unread} menções não lidas`, enabled: false },
    { label: `${alerts} alertas ativos`, enabled: false },
    { type: 'separator' },
    { label: 'Sincronizar agora', click: () => void ctx.scheduler?.trigger({}) },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() }
  ])
  trayRef.setTitle(unread > 0 ? String(unread) : '')
}

/**
 * Popula o inbox de menções uma única vez a partir do histórico já
 * sincronizado. Marca a flag em user_pref para não reprocessar.
 */
function seedMentionsOnce(db: Database.Database): void {
  const row = db.prepare(`SELECT value_json FROM user_pref WHERE key = 'mentionSeedDone'`).get() as
    { value_json: string } | undefined
  if (row?.value_json === '1') return
  const workspace = getWorkspaceRow(db)
  // sem workspace ainda (não conectado) — não marca a flag, tenta de novo no
  // próximo boot depois que a conta e o histórico existirem
  if (!workspace) return
  if (workspace.display_name) {
    seedMentionHistory(db, workspace.id, workspace.display_name)
  }
  db.prepare(
    `INSERT INTO user_pref (key, value_json) VALUES ('mentionSeedDone', '1')
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run()
}

function createWindow(): void {
  // createWindow() só roda depois de `ctx = new AppContext(db)` no whenReady
  // (e via activate/showMainWindow, ambos posteriores); ainda assim, sem db
  // cai no escuro — que é o DEFAULT_PREFS.theme.
  const theme = ctx?.db ? getPrefs(ctx.db).theme : 'dark'

  const mainWindow = new BrowserWindow({
    title: 'Jiraiya',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: themeBackgroundColor(theme),
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
  seedMentionsOnce(db)
  ctx = new AppContext(db)

  // alinha menus de contexto, scrollbars nativas e diálogos com a pref de tema
  nativeTheme.themeSource = getPrefs(db).theme
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

      // cards seguidos: mudanças de status e comentários de outras pessoas
      const watchEvents = runWatchEngine(db, workspace.id, workspace.account_id)
      if (notify) {
        // teto de 5 por sync — evita tempestade de notificações num sync grande
        for (const event of watchEvents.slice(0, 5)) {
          const n = new Notification({ title: 'Card seguido', body: event.message })
          n.on('click', () => {
            showMainWindow()
            ctx.push('push:open-issue', { key: event.issueKey })
          })
          n.show()
        }
      }

      ctx.push('push:mentions-updated', { unreadCount: unreadCount(db, workspace.id) })

      if (prefs.notifyMentions && notify) {
        for (const item of info.newMentions.slice(0, 5)) {
          const n = new Notification({
            title: `${item.authorName ?? 'Alguém'} mencionou você em ${item.issueKey}`,
            body: item.excerpt ?? ''
          })
          n.on('click', () => openIssue(item.issueKey))
          n.show()
        }
      }

      updateTray(db)

      // gera a daily de ontem após o sync (idempotente pela data local)
      triggerMorningBriefing(db)
    }
  })

  registerAuthHandlers(ctx)
  registerProjectHandlers(ctx)
  registerSyncHandlers(ctx)
  registerPrefsHandlers(ctx)
  registerAlertHandlers(ctx)
  registerIssueHandlers(ctx)
  registerSummaryHandlers(ctx)
  registerCreateHandlers(ctx)
  registerSplitHandlers(ctx)
  registerTeamHandlers(ctx)
  registerMentionHandlers(ctx)
  registerCommentHandlers(ctx)
  registerBoardHandlers(ctx)
  registerEditHandlers(ctx)
  registerAttachmentHandlers(ctx)
  registerAskHandlers(ctx)
  registerFilterHandlers(ctx)
  registerRiskHandlers(ctx)
  registerUpdateHandlers(ctx)
  registerSprintMoveHandlers(ctx)
  registerSearchHandlers(ctx)
  registerEpicHandlers(ctx)
  registerPrHandlers(ctx)
  registerPolishHandlers(ctx)
  registerTrendHandlers(ctx)
  registerWatchHandlers(ctx)
  registerNotesHandlers(ctx)
  registerWorklogExportHandlers(ctx)
  registerTrayPanelHandlers(ctx, { showWindow: showMainWindow })

  createWindow()

  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 18, height: 18 }))
  const trayRef = tray
  trayRef.on('click', () => toggleTrayPanel(trayRef))
  trayRef.on('right-click', () => {
    if (trayMenu) trayRef.popUpContextMenu(trayMenu)
  })
  updateTray(db)

  ctx.scheduler.start()

  stopWorklogReminder = startWorklogReminder({
    db,
    getClient: () => ctx.getClient(),
    showWindow: showMainWindow
  })

  // briefing matinal: deixa o primeiro sync andar antes de gerar a daily de ontem
  setTimeout(() => triggerMorningBriefing(db), 15_000)

  // verificação de atualização: no boot (se habilitada) e a cada 6h (checa a pref no disparo)
  if (getPrefs(db).updateCheck) {
    setTimeout(
      () =>
        void checkForUpdate(db, {
          notify: true,
          push: (v) => ctx.push('push:update-available', v)
        }),
      30_000
    )
  }
  updateTimer = setInterval(() => {
    if (!getPrefs(db).updateCheck) return
    void checkForUpdate(db, {
      notify: true,
      push: (v) => ctx.push('push:update-available', v)
    })
  }, UPDATE_INTERVAL_MS)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// limpa os anexos gravados em disco ao encerrar o app
app.on('will-quit', () => {
  if (updateTimer) {
    clearInterval(updateTimer)
    updateTimer = null
  }
  if (stopWorklogReminder) {
    stopWorklogReminder()
    stopWorklogReminder = null
  }
  clearTempDir()
})
