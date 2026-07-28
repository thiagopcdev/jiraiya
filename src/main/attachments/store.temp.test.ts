import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** temp isolado por execução; o store resolve o dir a cada chamada. */
const appTemp = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => appTemp.dir } }))

appTemp.dir = mkdtempSync(join(tmpdir(), 'jiraiya-attach-'))

const { TEMP_SUBDIR, clearTempDir, tempDirPath, tempDirSize, writeTempFile } =
  await import('./store')

const DIR = (): string => join(appTemp.dir, TEMP_SUBDIR)

afterAll(() => {
  rmSync(appTemp.dir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(DIR(), { recursive: true, force: true })
})

describe('tempDirPath', () => {
  it('fica dentro do temp do app, na subpasta do app', () => {
    expect(tempDirPath()).toBe(join(appTemp.dir, 'jiraiya-attachments'))
  })
})

describe('writeTempFile', () => {
  it('cria o diretório e grava os bytes', async () => {
    const path = await writeTempFile('print.png', Buffer.from([1, 2, 3]))

    expect(path).toBe(join(DIR(), 'print.png'))
    expect(Array.from(readFileSync(path))).toEqual([1, 2, 3])
  })

  it('sanitiza caminho no nome: só o basename, sem subir de diretório', async () => {
    const path = await writeTempFile('../../etc/passwd', Buffer.from('x'))

    expect(path).toBe(join(DIR(), 'passwd'))
  })

  it('remove sequências de pontos do nome', async () => {
    const path = await writeTempFile('nota..txt', Buffer.from('x'))

    expect(path).toBe(join(DIR(), 'nota.txt'))
  })

  it("nome degenerado cai no fallback 'arquivo'", async () => {
    expect(await writeTempFile('   ', Buffer.from('x'))).toBe(join(DIR(), 'arquivo'))
    expect(await writeTempFile('.', Buffer.from('x'))).toBe(join(DIR(), 'arquivo'))
  })

  it('sobrescreve arquivo de mesmo nome', async () => {
    await writeTempFile('a.txt', Buffer.from('antigo'))
    const path = await writeTempFile('a.txt', Buffer.from('novo'))

    expect(readFileSync(path, 'utf8')).toBe('novo')
  })
})

describe('tempDirSize', () => {
  it('diretório inexistente → 0', () => {
    expect(tempDirSize()).toBe(0)
  })

  it('soma o tamanho dos arquivos e ignora subdiretórios', async () => {
    await writeTempFile('a.bin', Buffer.alloc(100))
    await writeTempFile('b.bin', Buffer.alloc(50))
    mkdirSync(join(DIR(), 'sub'), { recursive: true })
    writeFileSync(join(DIR(), 'sub', 'c.bin'), Buffer.alloc(1000))

    expect(tempDirSize()).toBe(150)
  })
})

describe('clearTempDir', () => {
  it('diretório inexistente → 0 liberado', () => {
    expect(clearTempDir()).toBe(0)
  })

  it('apaga os arquivos e devolve os bytes liberados', async () => {
    await writeTempFile('a.bin', Buffer.alloc(10))
    await writeTempFile('b.bin', Buffer.alloc(20))

    expect(clearTempDir()).toBe(30)
    expect(tempDirSize()).toBe(0)
    expect(existsSync(DIR())).toBe(true)
  })

  it('subdiretório é preservado (não é arquivo)', async () => {
    await writeTempFile('a.bin', Buffer.alloc(5))
    mkdirSync(join(DIR(), 'sub'), { recursive: true })

    expect(clearTempDir()).toBe(5)
    expect(existsSync(join(DIR(), 'sub'))).toBe(true)
  })
})
