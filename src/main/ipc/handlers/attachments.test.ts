import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

/** temp dir próprio + dialog controlável, sobre o electronMock padrão. */
const el = vi.hoisted(() => ({
  tempRoot: '',
  saveDialog: { canceled: true, filePath: undefined as string | undefined },
  openedPaths: [] as string[]
}))

vi.mock('electron', async () => {
  const { mkdtempSync: mk } = await import('fs')
  const { tmpdir: tmp } = await import('os')
  const { join: jn } = await import('path')
  el.tempRoot = mk(jn(tmp(), 'jiraiya-attach-test-'))
  const base = (await import('../../testing/electronMock')).createElectronMock()
  return {
    ...base,
    app: { ...(base.app as object), getPath: () => el.tempRoot },
    dialog: { showSaveDialog: async () => el.saveDialog },
    shell: {
      openExternal: async () => {},
      openPath: async (path: string) => {
        el.openedPaths.push(path)
        return ''
      }
    }
  }
})

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { registerAttachmentHandlers } = await import('./attachments')
const { TEMP_SUBDIR } = await import('../../attachments/store')

type Ctx = ReturnType<typeof makeTestContext>
type Fake = Record<string, unknown>

function client(methods: Fake): Partial<JiraClient> {
  return methods as unknown as Partial<JiraClient>
}

function ok<C extends IpcChannel>(res: IpcResult<C>): IpcResponse<C> {
  if (!res.ok) throw new Error(`esperava ok, veio ${res.code}: ${res.message}`)
  return res.data
}

function err<C extends IpcChannel>(res: IpcResult<C>): { code: string; message: string } {
  if (res.ok) throw new Error('esperava erro, veio ok')
  return { code: res.code, message: res.message }
}

function setup(methods: Fake = {}): Ctx {
  const t = makeTestContext({ client: client(methods) })
  registerAttachmentHandlers(t.ctx)
  return t
}

/** ids únicos por teste: o cache de anexos é module-level e sobrevive entre testes. */
let seq = 0
function nextId(): string {
  seq += 1
  return `att-${seq}`
}

beforeEach(() => {
  resetElectronMock()
  el.saveDialog = { canceled: true, filePath: undefined }
  el.openedPaths.length = 0
})

describe('issues:attachments', () => {
  it('lista anexos marcando imagens', async () => {
    const issueAttachments = vi.fn(async () => [
      { id: 'a1', filename: 'print.png', mimeType: 'image/png', size: 10 },
      { id: 'a2', filename: 'log.txt', mimeType: 'text/plain', size: 20 },
      { id: 'a3', filename: 'x.bin', mimeType: null, size: 5 }
    ])
    setup({ issueAttachments })

    const data = ok(await invokeHandler('issues:attachments', { key: 'abc-1' }))

    expect(issueAttachments).toHaveBeenCalledWith('ABC-1')
    expect(data.attachments.map((a) => a.isImage)).toEqual([true, false, false])
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issues:attachments', { key: 'ABC-1' })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup({ issueAttachments: async () => [] })
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('issues:attachments', { key: 'ABC-1' })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('key vazia → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issues:attachments', { key: '' })).code).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:attachmentUpload', () => {
  it('deduz o mime pela extensão e devolve o anexo criado', async () => {
    const addAttachment = vi.fn(async () => ({
      id: 'a9',
      filename: 'print.png',
      mimeType: null,
      size: 3
    }))
    setup({ addAttachment })

    const data = ok(
      await invokeHandler('issues:attachmentUpload', {
        key: 'abc-1',
        filename: ' print.png ',
        dataBase64: Buffer.from('abc').toString('base64')
      })
    )

    expect(addAttachment).toHaveBeenCalledWith(
      'ABC-1',
      'print.png',
      Buffer.from('abc'),
      'image/png'
    )
    expect(data.attachment).toEqual({
      id: 'a9',
      filename: 'print.png',
      mimeType: 'image/png',
      size: 3,
      isImage: true
    })
  })

  it('extensão desconhecida → mime null e isImage false', async () => {
    const addAttachment = vi.fn(async () => ({
      id: 'a9',
      filename: 'dados.xyz',
      mimeType: null,
      size: 3
    }))
    setup({ addAttachment })

    const data = ok(
      await invokeHandler('issues:attachmentUpload', {
        key: 'ABC-1',
        filename: 'dados.xyz',
        dataBase64: Buffer.from('abc').toString('base64')
      })
    )

    expect(addAttachment).toHaveBeenCalledWith('ABC-1', 'dados.xyz', Buffer.from('abc'), null)
    expect(data.attachment).toMatchObject({ mimeType: null, isImage: false })
  })

  it('mime devolvido pelo Jira vence o deduzido', async () => {
    setup({
      addAttachment: async () => ({
        id: 'a9',
        filename: 'foto.jpg',
        mimeType: 'image/jpeg',
        size: 3
      })
    })

    const data = ok(
      await invokeHandler('issues:attachmentUpload', {
        key: 'ABC-1',
        filename: 'foto.jpg',
        dataBase64: Buffer.from('abc').toString('base64')
      })
    )
    expect(data.attachment.mimeType).toBe('image/jpeg')
  })

  it('base64 sem bytes válidos → VALIDATION', async () => {
    setup({ addAttachment: async () => ({ id: 'x', filename: 'x', mimeType: null, size: 0 }) })

    expect(
      err(
        await invokeHandler('issues:attachmentUpload', {
          key: 'ABC-1',
          filename: 'x.png',
          dataBase64: '!!!'
        })
      ).code
    ).toBe('VALIDATION')
  })

  it('acima de 20 MB → FILE_TOO_LARGE', async () => {
    setup({ addAttachment: async () => ({ id: 'x', filename: 'x', mimeType: null, size: 0 }) })
    const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64')

    const e = err(
      await invokeHandler('issues:attachmentUpload', {
        key: 'ABC-1',
        filename: 'grande.zip',
        dataBase64: big
      })
    )
    expect(e.code).toBe('FILE_TOO_LARGE')
    expect(e.message).toContain('21.0 MB')
  })
})

describe('issues:attachmentData', () => {
  it('busca a thumbnail e devolve data URI', async () => {
    const id = nextId()
    const attachmentThumbnail = vi.fn(async () => ({
      data: Buffer.from('img'),
      mimeType: 'image/png'
    }))
    setup({ attachmentThumbnail })

    const data = ok(
      await invokeHandler('issues:attachmentData', { attachmentId: id, variant: 'thumbnail' })
    )

    expect(data).toEqual({
      dataUri: `data:image/png;base64,${Buffer.from('img').toString('base64')}`,
      mimeType: 'image/png',
      tooLarge: false
    })
    expect(attachmentThumbnail).toHaveBeenCalledTimes(1)
  })

  it('segunda chamada vem do cache (não bate no Jira)', async () => {
    const id = nextId()
    const attachmentContent = vi.fn(async () => ({ data: Buffer.from('pdf'), mimeType: null }))
    setup({ attachmentContent })

    const first = ok(
      await invokeHandler('issues:attachmentData', { attachmentId: id, variant: 'full' })
    )
    const second = ok(
      await invokeHandler('issues:attachmentData', { attachmentId: id, variant: 'full' })
    )

    expect(attachmentContent).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(first.dataUri).toContain('data:application/octet-stream;base64,')
  })

  it('arquivo cheio acima de 8 MB → tooLarge sem data URI', async () => {
    const id = nextId()
    const attachmentContent = vi.fn(async () => ({
      data: Buffer.alloc(9 * 1024 * 1024, 2),
      mimeType: 'application/pdf'
    }))
    setup({ attachmentContent })

    const data = ok(
      await invokeHandler('issues:attachmentData', { attachmentId: id, variant: 'full' })
    )
    expect(data).toEqual({ dataUri: null, mimeType: 'application/pdf', tooLarge: true })

    // não cacheou: segunda chamada bate no Jira de novo
    ok(await invokeHandler('issues:attachmentData', { attachmentId: id, variant: 'full' }))
    expect(attachmentContent).toHaveBeenCalledTimes(2)
  })

  it('variant fora do enum → INVALID_PAYLOAD', async () => {
    setup()
    const bad = { attachmentId: 'x', variant: 'medio' } as unknown as Parameters<
      typeof invokeHandler<'issues:attachmentData'>
    >[1]
    expect(err(await invokeHandler('issues:attachmentData', bad)).code).toBe('INVALID_PAYLOAD')
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(
      err(await invokeHandler('issues:attachmentData', { attachmentId: 'x', variant: 'full' })).code
    ).toBe('NOT_CONNECTED')
  })
})

describe('issues:attachmentSave', () => {
  it('sem janela principal → não salva', async () => {
    setup({ attachmentContent: async () => ({ data: Buffer.from('x'), mimeType: null }) })

    expect(
      ok(await invokeHandler('issues:attachmentSave', { attachmentId: 'a1', filename: 'a.txt' }))
    ).toEqual({ saved: false, path: null })
  })

  it('diálogo cancelado → não salva', async () => {
    const t = setup({ attachmentContent: async () => ({ data: Buffer.from('x'), mimeType: null }) })
    t.ctx.mainWindow = {} as never

    expect(
      ok(await invokeHandler('issues:attachmentSave', { attachmentId: 'a1', filename: 'a.txt' }))
    ).toEqual({ saved: false, path: null })
  })

  it('escreve o arquivo escolhido e cacheia os bytes', async () => {
    const id = nextId()
    const dest = join(mkdtempSync(join(tmpdir(), 'jiraiya-save-')), 'saida.txt')
    el.saveDialog = { canceled: false, filePath: dest }
    const attachmentContent = vi.fn(async () => ({
      data: Buffer.from('conteúdo'),
      mimeType: 'text/plain'
    }))
    const t = setup({ attachmentContent })
    t.ctx.mainWindow = {} as never

    const data = ok(
      await invokeHandler('issues:attachmentSave', { attachmentId: id, filename: 'saida.txt' })
    )

    expect(data).toEqual({ saved: true, path: dest })
    expect(readFileSync(dest, 'utf8')).toBe('conteúdo')

    // segundo download usa o cache `full:`
    ok(await invokeHandler('issues:attachmentSave', { attachmentId: id, filename: 'saida.txt' }))
    expect(attachmentContent).toHaveBeenCalledTimes(1)
  })
})

describe('issues:attachmentOpen', () => {
  it('grava no temp dir e abre no sistema', async () => {
    const id = nextId()
    setup({
      attachmentContent: async () => ({ data: Buffer.from('abre'), mimeType: 'text/plain' })
    })

    const data = ok(
      await invokeHandler('issues:attachmentOpen', { attachmentId: id, filename: 'nota.txt' })
    )

    expect(data).toEqual({ ok: true })
    expect(el.openedPaths).toHaveLength(1)
    expect(el.openedPaths[0]).toContain(TEMP_SUBDIR)
    expect(readFileSync(el.openedPaths[0], 'utf8')).toBe('abre')
  })
})

describe('app:tempFiles e app:tempClear', () => {
  it('soma os bytes do temp dir e limpa', async () => {
    setup()
    const dir = join(el.tempRoot, TEMP_SUBDIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100, 7))

    const before = ok(await invokeHandler('app:tempFiles', {}))
    expect(before.bytes).toBeGreaterThanOrEqual(100)

    const cleared = ok(await invokeHandler('app:tempClear', {}))
    expect(cleared.ok).toBe(true)
    expect(cleared.freedBytes).toBe(before.bytes)
    expect(ok(await invokeHandler('app:tempFiles', {})).bytes).toBe(0)
  })
})
