import { clipboard, dialog, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getPrefs, setPrefs } from '../../db/repos/misc'
import { getWorkspaceRow } from '../../db/repos/workspace'

export function registerPrefsHandlers(ctx: AppContext): void {
  handle('prefs:get', () => getPrefs(ctx.db))

  handle('prefs:set', (patch) => {
    const prefs = setPrefs(ctx.db, patch)
    ctx.scheduler?.reschedule()
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
