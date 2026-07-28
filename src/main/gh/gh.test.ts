import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { listCommandLog } from '../db/repos/commandLog'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

/** Caminhos que "existem"; cada teste ajusta. */
const present = new Set<string>()
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return { ...real, existsSync: (p: string) => present.has(p) }
})

const { ghAvailable, initGhLogging, resolveGhBinary, runGh } = await import('./gh')

interface ExecError extends Error {
  killed?: boolean
  signal?: string
}

function ghReplies(
  err: ExecError | null,
  stdout = '',
  stderr = ''
): { stdinEnded: boolean; opts: Record<string, unknown> | null } {
  const state = { stdinEnded: false, opts: null as Record<string, unknown> | null }
  execFileMock.mockImplementation(
    (
      _bin: string,
      _args: string[],
      opts: Record<string, unknown>,
      cb: (e: ExecError | null, out: string, errOut: string) => void
    ) => {
      state.opts = opts
      setTimeout(() => cb(err, stdout, stderr), 0)
      return {
        stdin: {
          end: () => {
            state.stdinEnded = true
          }
        }
      }
    }
  )
  return state
}

beforeEach(() => {
  execFileMock.mockReset()
  present.clear()
})

describe('resolveGhBinary / ghAvailable', () => {
  it('sem gh instalado: null e indisponível', () => {
    expect(resolveGhBinary()).toBeNull()
    expect(ghAvailable()).toBe(false)
  })

  it('prefere o primeiro caminho da lista de candidatos', () => {
    present.add('/usr/local/bin/gh')
    present.add('/opt/homebrew/bin/gh')

    expect(resolveGhBinary()).toBe('/opt/homebrew/bin/gh')
    expect(ghAvailable()).toBe(true)
  })

  it('encontra em /usr/bin quando é o único', () => {
    present.add('/usr/bin/gh')
    expect(resolveGhBinary()).toBe('/usr/bin/gh')
  })
})

describe('runGh', () => {
  it('sem binário lança sem executar nada', async () => {
    await expect(runGh(['pr', 'list'])).rejects.toThrow('CLI do gh não encontrado')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('sucesso devolve stdout, fecha o stdin e usa timeout/maxBuffer padrão', async () => {
    present.add('/opt/homebrew/bin/gh')
    const state = ghReplies(null, '[{"number":1}]')

    await expect(runGh(['search', 'prs', 'BT-1'])).resolves.toBe('[{"number":1}]')
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/homebrew/bin/gh')
    expect(execFileMock.mock.calls[0][1]).toEqual(['search', 'prs', 'BT-1'])
    expect(state.stdinEnded).toBe(true)
    expect(state.opts).toMatchObject({ timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
  })

  it('timeout customizado é repassado ao execFile', async () => {
    present.add('/opt/homebrew/bin/gh')
    const state = ghReplies(null, 'ok')

    await runGh(['auth', 'status'], 1500)
    expect(state.opts).toMatchObject({ timeout: 1500 })
  })

  it('processo morto por timeout tem mensagem própria', async () => {
    present.add('/opt/homebrew/bin/gh')
    ghReplies(Object.assign(new Error('killed'), { killed: true }))

    await expect(runGh(['pr', 'view', '1'])).rejects.toThrow('gh excedeu o tempo limite')
  })

  it('SIGTERM também é tratado como tempo limite', async () => {
    present.add('/opt/homebrew/bin/gh')
    ghReplies(Object.assign(new Error('term'), { signal: 'SIGTERM' }))

    await expect(runGh(['pr', 'view', '1'])).rejects.toThrow('gh excedeu o tempo limite')
  })

  it('erro comum usa o stderr truncado em 200 chars', async () => {
    present.add('/opt/homebrew/bin/gh')
    ghReplies(new Error('exit 1'), '', `  ${'z'.repeat(300)}  `)

    await expect(runGh(['pr', 'list'])).rejects.toThrow(`gh falhou: ${'z'.repeat(200)}`)
  })

  it('stderr vazio cai no message do erro', async () => {
    present.add('/opt/homebrew/bin/gh')
    ghReplies(new Error('gh: not logged in'), '', '   ')

    await expect(runGh(['pr', 'list'])).rejects.toThrow('gh falhou: gh: not logged in')
  })
})

describe('initGhLogging — auditoria em command_log', () => {
  let db: Database.Database

  beforeEach(() => {
    present.add('/opt/homebrew/bin/gh')
    db = new Database(':memory:')
    runMigrations(db)
    initGhLogging(db)
  })

  it('sucesso grava linha kind=cli provider=gh com o comando redigido', async () => {
    ghReplies(null, 'ok')

    await runGh(['search', 'prs', 'BT-1', '--json', 'number'])

    const [entry] = listCommandLog(db)
    expect(entry).toMatchObject({ kind: 'cli', provider: 'gh', ok: true, error: null })
    expect(entry.command).toBe('/opt/homebrew/bin/gh search prs BT-1 --json number')
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('falha grava a linha com ok=false e a mensagem', async () => {
    ghReplies(new Error('exit 1'), '', 'no such repo')

    await expect(runGh(['pr', 'view', '9'])).rejects.toThrow()

    const [entry] = listCommandLog(db)
    expect(entry.ok).toBe(false)
    expect(entry.error).toBe('gh falhou: no such repo')
  })

  it('argumento gigante é truncado na auditoria', async () => {
    ghReplies(null, 'ok')

    await runGh(['api', 'x'.repeat(400)])

    expect(listCommandLog(db)[0].command).toContain('(+100 chars)')
  })

  it('erro ao gravar auditoria não afeta o resultado', async () => {
    db.prepare('DROP TABLE command_log').run()
    ghReplies(null, 'ok')

    await expect(runGh(['pr', 'list'])).resolves.toBe('ok')
  })
})
