import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { applyBackup, buildBackup, type ImportCounts } from '../../backup'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

/** YYYY-MM-DD no fuso local (nome de arquivo previsível para o usuário). */
function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const EMPTY_COUNTS: ImportCounts = {
  notes: 0,
  watches: 0,
  filters: 0,
  templates: 0,
  prefs: false
}

export function registerBackupHandlers(ctx: AppContext): void {
  handle('backup:export', async () => {
    const workspace = requireWorkspace(ctx)
    const win = ctx.mainWindow
    const options = {
      defaultPath: `jiraiya-backup-${localDate(new Date())}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: true as const, path: null }

    const data = buildBackup(ctx.db, workspace, new Date().toISOString())
    await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8')
    return { ok: true as const, path: result.filePath }
  })

  handle('backup:import', async () => {
    const workspace = requireWorkspace(ctx)
    const win = ctx.mainWindow
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) {
      return { ok: true as const, canceled: true, imported: { ...EMPTY_COUNTS } }
    }

    const text = await readFile(path, 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new AppError('BACKUP_INVALID', 'Arquivo inválido')
    }

    let imported: ImportCounts
    try {
      imported = applyBackup(ctx.db, workspace.id, raw)
    } catch (err) {
      throw new AppError('BACKUP_INVALID', err instanceof Error ? err.message : 'Arquivo inválido')
    }

    // cards seguidos/notas restaurados entram no próximo ciclo — o refresh
    // imediato faz a UI recarregar já com o conteúdo importado
    void ctx.scheduler?.trigger({})
    return { ok: true as const, canceled: false, imported }
  })
}
