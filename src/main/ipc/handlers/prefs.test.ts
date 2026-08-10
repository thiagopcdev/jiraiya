import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dialogState = vi.hoisted(() => ({
  save: { canceled: true, filePath: undefined as string | undefined }
}))

vi.mock('electron', async () => {
  const base = (await import('../../testing/electronMock')).createElectronMock()
  return { ...base, dialog: { showSaveDialog: async () => dialogState.save } }
})

const { clipboardWrites, invokeHandler, openedExternal, resetElectronMock } =
  await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerPrefsHandlers, themeBackgroundColor } = await import('./prefs')

type Ctx = ReturnType<typeof makeTestContext>

let t: Ctx

function fakeWindow(): { calls: string[] } {
  const calls: string[] = []
  Object.assign(t.ctx, {
    mainWindow: { setBackgroundColor: (c: string) => calls.push(c) }
  })
  return { calls }
}

beforeEach(() => {
  resetElectronMock()
  dialogState.save = { canceled: true, filePath: undefined }
  t = makeTestContext()
  registerPrefsHandlers(t.ctx)
})

describe('themeBackgroundColor', () => {
  it('dark explícito → #09090b e light → #f4f4f5', () => {
    expect(themeBackgroundColor('dark')).toBe('#09090b')
    expect(themeBackgroundColor('light')).toBe('#f4f4f5')
  })

  it('system segue o nativeTheme (mock: escuro)', () => {
    expect(themeBackgroundColor('system')).toBe('#09090b')
  })
})

describe('prefs:get / prefs:set', () => {
  it('prefs:get devolve os defaults quando nada foi salvo', async () => {
    const res = await invokeHandler('prefs:get', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.stalledDays).toBeGreaterThan(0)
  })

  it('prefs:set persiste o patch e reflete no prefs:get', async () => {
    const res = await invokeHandler('prefs:set', { stalledDays: 9 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.stalledDays).toBe(9)

    const again = await invokeHandler('prefs:get', {})
    expect(again.ok && again.data.stalledDays).toBe(9)
  })

  it('prefs:set com theme ajusta o backgroundColor da janela', async () => {
    const win = fakeWindow()
    const res = await invokeHandler('prefs:set', { theme: 'light' })
    expect(res.ok).toBe(true)
    expect(win.calls).toEqual(['#f4f4f5'])
  })

  it('prefs:set com density persiste e sobrevive ao round-trip do prefs:get', async () => {
    const res = await invokeHandler('prefs:set', { density: 'compact' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.density).toBe('compact')

    const again = await invokeHandler('prefs:get', {})
    expect(again.ok && again.data.density).toBe('compact')
  })

  it('payload fora do range → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('prefs:set', { stalledDays: 999 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})

describe('app:info', () => {
  it('devolve a versão do app', async () => {
    const res = await invokeHandler('app:info', {})
    expect(res.ok && res.data.version).toBe('0.0.0-test')
  })
})

describe('shell:openIssue', () => {
  it('key válida abre a URL de browse do site', async () => {
    const res = await invokeHandler('shell:openIssue', { issueKey: 'BT-12' })
    expect(res.ok).toBe(true)
    expect(openedExternal).toEqual(['https://x.atlassian.net/browse/BT-12'])
  })

  it('key inválida → INVALID_KEY e nada é aberto', async () => {
    const res = await invokeHandler('shell:openIssue', { issueKey: 'nao-uma-key!' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_KEY')
    expect(openedExternal).toEqual([])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('shell:openIssue', { issueKey: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('export:clipboard', () => {
  it('escreve o texto no clipboard', async () => {
    const res = await invokeHandler('export:clipboard', { text: '# resumo' })
    expect(res.ok).toBe(true)
    expect(clipboardWrites).toEqual(['# resumo'])
  })
})

describe('export:file', () => {
  it('sem janela principal → saved false', async () => {
    const res = await invokeHandler('export:file', { content: 'x', suggestedName: 'a.md' })
    expect(res.ok && res.data).toEqual({ saved: false, path: null })
  })

  it('dialog cancelado → saved false', async () => {
    fakeWindow()
    const res = await invokeHandler('export:file', { content: 'x', suggestedName: 'a.md' })
    expect(res.ok && res.data).toEqual({ saved: false, path: null })
  })

  it('dialog confirmado grava o arquivo no disco', async () => {
    fakeWindow()
    const path = join(tmpdir(), `jiraiya-prefs-test-${Date.now()}.md`)
    dialogState.save = { canceled: false, filePath: path }
    try {
      const res = await invokeHandler('export:file', {
        content: '# conteudo',
        suggestedName: 'a.md'
      })
      expect(res.ok && res.data).toEqual({ saved: true, path })
      expect(await readFile(path, 'utf8')).toBe('# conteudo')
    } finally {
      await rm(path, { force: true })
    }
  })
})
