import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupData } from '../../backup'

const dialogState = vi.hoisted(() => ({
  save: { canceled: true, filePath: undefined as string | undefined },
  open: { canceled: true, filePaths: [] as string[] },
  saveArgCounts: [] as number[],
  openArgCounts: [] as number[]
}))

vi.mock('electron', async () => {
  const base = (await import('../../testing/electronMock')).createElectronMock()
  return {
    ...base,
    dialog: {
      showSaveDialog: async (...args: unknown[]) => {
        dialogState.saveArgCounts.push(args.length)
        return dialogState.save
      },
      showOpenDialog: async (...args: unknown[]) => {
        dialogState.openArgCounts.push(args.length)
        return dialogState.open
      }
    }
  }
})

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerBackupHandlers } = await import('./backup')

let t: ReturnType<typeof makeTestContext>
let dir: string
let triggers: number

const EMPTY_COUNTS = { notes: 0, watches: 0, filters: 0, templates: 0, prefs: false }

function validBackup(over: Partial<BackupData> = {}): Record<string, unknown> {
  return {
    app: 'jiraiya',
    backupVersion: 1,
    exportedAt: '2026-07-01T00:00:00.000Z',
    siteUrl: 'https://x.atlassian.net',
    notes: [{ issueKey: 'BT-1', content: 'nota', updatedAt: '2026-07-01T00:00:00.000Z' }],
    watches: ['BT-2'],
    filters: [{ name: 'Meus', jql: 'assignee = currentUser()', position: 0 }],
    templates: [{ name: 'PR', content: 'PR: {url}', position: 0 }],
    ...over
  }
}

beforeEach(async () => {
  dialogState.save = { canceled: true, filePath: undefined }
  dialogState.open = { canceled: true, filePaths: [] }
  dialogState.saveArgCounts = []
  dialogState.openArgCounts = []
  dir = await mkdtemp(join(tmpdir(), 'jiraiya-backup-'))
  triggers = 0
  t = makeTestContext()
  Object.assign(t.ctx, {
    scheduler: {
      trigger: async () => {
        triggers++
        return true
      }
    }
  })
  registerBackupHandlers(t.ctx)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('backup:export', () => {
  it('dialog cancelado → path null e nada é escrito', async () => {
    const res = await invokeHandler('backup:export', {})
    expect(res.ok && res.data).toEqual({ ok: true, path: null })
  })

  it('confirmado grava o JSON do backup no arquivo escolhido', async () => {
    t.db
      .prepare(
        `INSERT INTO issue_note (workspace_id, issue_key, content, updated_at)
         VALUES (1, 'BT-1', 'minha nota', '2026-07-01T00:00:00.000Z')`
      )
      .run()
    const path = join(dir, 'backup.json')
    dialogState.save = { canceled: false, filePath: path }

    const res = await invokeHandler('backup:export', {})
    expect(res.ok && res.data).toEqual({ ok: true, path })

    const parsed = JSON.parse(await readFile(path, 'utf8')) as BackupData
    expect(parsed.app).toBe('jiraiya')
    expect(parsed.backupVersion).toBe(1)
    expect(parsed.notes).toEqual([
      { issueKey: 'BT-1', content: 'minha nota', updatedAt: '2026-07-01T00:00:00.000Z' }
    ])
  })

  it('sem janela principal o dialog abre sem owner; com janela abre modal', async () => {
    await invokeHandler('backup:export', {})
    Object.assign(t.ctx, { mainWindow: {} })
    await invokeHandler('backup:export', {})
    expect(dialogState.saveArgCounts).toEqual([1, 2])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('backup:export', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('backup:import', () => {
  it('dialog cancelado → canceled true e contagens zeradas', async () => {
    const res = await invokeHandler('backup:import', {})
    expect(res.ok && res.data).toEqual({ ok: true, canceled: true, imported: EMPTY_COUNTS })
    expect(triggers).toBe(0)
  })

  it('arquivo válido é mesclado e agenda refresh imediato', async () => {
    const path = join(dir, 'ok.json')
    await writeFile(path, JSON.stringify(validBackup()), 'utf8')
    dialogState.open = { canceled: false, filePaths: [path] }

    const res = await invokeHandler('backup:import', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.canceled).toBe(false)
    expect(res.data.imported).toEqual({
      notes: 1,
      watches: 1,
      filters: 1,
      templates: 1,
      prefs: false
    })
    expect(triggers).toBe(1)
  })

  it('JSON malformado → BACKUP_INVALID', async () => {
    const path = join(dir, 'ruim.json')
    await writeFile(path, '{ nao é json', 'utf8')
    dialogState.open = { canceled: false, filePaths: [path] }

    const res = await invokeHandler('backup:import', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('BACKUP_INVALID')
    expect(res.message).toBe('Arquivo inválido')
  })

  it('JSON válido que não é backup do Jiraiya → BACKUP_INVALID com o motivo', async () => {
    const path = join(dir, 'outro.json')
    await writeFile(path, JSON.stringify({ app: 'outro-app' }), 'utf8')
    dialogState.open = { canceled: false, filePaths: [path] }

    const res = await invokeHandler('backup:import', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('BACKUP_INVALID')
    expect(res.message).toContain('backup válido')
  })

  it('sem janela principal o dialog abre sem owner; com janela abre modal', async () => {
    await invokeHandler('backup:import', {})
    Object.assign(t.ctx, { mainWindow: {} })
    await invokeHandler('backup:import', {})
    expect(dialogState.openArgCounts).toEqual([1, 2])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('backup:import', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
