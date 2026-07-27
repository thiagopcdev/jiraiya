import { app, clipboard, dialog, nativeTheme, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { ThemePref } from '@shared/domain'
import { getPrefs, setPrefs } from '../../db/repos/misc'
import { getWorkspaceRow } from '../../db/repos/workspace'

/**
 * Cor de fundo nativa da janela para o tema informado. Usada na criação da
 * BrowserWindow (evita flash escuro no boot com tema claro) e quando a pref
 * muda em runtime. 'system' resolve pelo tema do OS.
 */
export function themeBackgroundColor(theme: ThemePref): string {
  const dark = theme === 'system' ? nativeTheme.shouldUseDarkColors : theme === 'dark'
  return dark ? '#09090b' : '#f4f4f5'
}

export function registerPrefsHandlers(ctx: AppContext): void {
  handle('prefs:get', () => getPrefs(ctx.db))

  handle('app:info', () => ({ version: app.getVersion() }))

  handle('prefs:set', (patch) => {
    const prefs = setPrefs(ctx.db, patch)
    ctx.scheduler?.reschedule()
    if (patch.theme !== undefined) {
      // themeSource ajusta o chrome nativo (menus, scrollbars, diálogos);
      // o backgroundColor evita flash da cor antiga em reloads/resizes
      nativeTheme.themeSource = prefs.theme
      ctx.mainWindow?.setBackgroundColor(themeBackgroundColor(prefs.theme))
    }
    return prefs
  })

  handle('shell:openIssue', ({ issueKey }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    if (!/^[A-Z][A-Z0-9]*-\d+$/i.test(issueKey)) {
      throw new AppError('INVALID_KEY', 'Chave de issue inválida')
    }
    void shell.openExternal(`${workspace.site_url.replace(/\/$/, '')}/browse/${issueKey}`)
    return { ok: true as const }
  })

  handle('export:clipboard', ({ text }) => {
    clipboard.writeText(text)
    return { ok: true as const }
  })

  handle('export:file', async ({ content, suggestedName }) => {
    const win = ctx.mainWindow
    if (!win) return { saved: false, path: null }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false, path: null }
    await writeFile(result.filePath, content, 'utf8')
    return { saved: true, path: result.filePath }
  })
}
