import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { listCommandLog } from '../db/repos/commandLog'
import { AiUnavailableError } from './types'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

const existsSyncMock = vi.hoisted(() => vi.fn())
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: existsSyncMock
}))

const { resolveBinary, runCliBinary } = await import('./exec')
const { initAiRegistry } = await import('./registry')

interface ExecError extends Error {
  killed?: boolean
  signal?: string
}

/** Programa o execFile mockado para responder com (err, stdout, stderr). */
function respondWith(err: ExecError | null, stdout = '', stderr = ''): { stdinEnded: boolean } {
  const state = { stdinEnded: false }
  execFileMock.mockImplementation(
    (
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: ExecError | null, out: string, errOut: string) => void
    ) => {
      // execFile é assíncrono na produção: responde no próximo tick
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

const INPUT = { binary: '/bin/fake-cli', args: ['-p', 'oi'], label: 'Claude', provider: 'claude' }

describe('resolveBinary', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
  })

  it('devolve o primeiro candidato existente', () => {
    existsSyncMock.mockImplementation((p: string) => p === '/usr/local/bin/claude')
    expect(resolveBinary(['/nao/existe', '/usr/local/bin/claude', '/opt/claude'])).toBe(
      '/usr/local/bin/claude'
    )
  })

  it('devolve null quando nenhum candidato existe', () => {
    existsSyncMock.mockReturnValue(false)
    expect(resolveBinary(['/a', '/b'])).toBeNull()
  })

  it('lista vazia → null', () => {
    expect(resolveBinary([])).toBeNull()
  })
})

describe('runCliBinary', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('sucesso devolve o stdout cru e fecha o stdin do processo', async () => {
    const state = respondWith(null, '{"result":"ok"}')

    await expect(runCliBinary(INPUT)).resolves.toBe('{"result":"ok"}')
    expect(state.stdinEnded).toBe(true)
  })

  it('passa timeout, maxBuffer e cwd do userData para o execFile', async () => {
    respondWith(null, 'x')
    await runCliBinary({ ...INPUT, timeoutMs: 1234 })

    const opts = execFileMock.mock.calls[0][2] as {
      timeout: number
      maxBuffer: number
      cwd: string
      env: Record<string, string>
    }
    expect(opts.timeout).toBe(1234)
    expect(opts.maxBuffer).toBe(8 * 1024 * 1024)
    expect(typeof opts.cwd).toBe('string')
    expect(opts.env).toBeTypeOf('object')
  })

  it('usa timeout default de 240s quando não informado', async () => {
    respondWith(null, 'x')
    await runCliBinary(INPUT)

    const opts = execFileMock.mock.calls[0][2] as { timeout: number }
    expect(opts.timeout).toBe(240_000)
  })

  it('erro com killed → mensagem de tempo limite com os segundos', async () => {
    const err: ExecError = Object.assign(new Error('killed'), { killed: true })
    respondWith(err)

    await expect(runCliBinary({ ...INPUT, timeoutMs: 5000 })).rejects.toThrow(
      /excedeu o tempo limite \(5s\)/
    )
  })

  it('erro com signal SIGTERM (sem killed) também vira tempo limite', async () => {
    const err: ExecError = Object.assign(new Error('term'), { signal: 'SIGTERM' })
    respondWith(err)

    const promise = runCliBinary(INPUT)
    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError)
    await expect(promise).rejects.toThrow(/excedeu o tempo limite/)
  })

  it('erro comum usa o stderr filtrado (sem linhas Warning: nem vazias)', async () => {
    respondWith(
      new Error('exit 1'),
      '',
      'Warning: stdin não é um tty\n\nfalha real de autenticação\nWarning: outro aviso'
    )

    await expect(runCliBinary(INPUT)).rejects.toThrow(
      'CLI do Claude falhou: falha real de autenticação'
    )
  })

  it('stderr só com warnings cai no err.message', async () => {
    respondWith(new Error('maxBuffer length exceeded'), '', 'Warning: só aviso\n')

    await expect(runCliBinary(INPUT)).rejects.toThrow(
      'CLI do Claude falhou: maxBuffer length exceeded'
    )
  })

  it('stderr ausente cai no err.message', async () => {
    execFileMock.mockImplementation(
      (
        _bin: string,
        _args: string[],
        _opts: unknown,
        cb: (e: ExecError | null, out: string, errOut: string | undefined) => void
      ) => {
        setTimeout(() => cb(new Error('spawn ENOENT'), '', undefined), 0)
        return { stdin: null }
      }
    )

    await expect(runCliBinary(INPUT)).rejects.toThrow('CLI do Claude falhou: spawn ENOENT')
  })

  it('stderr gigante é truncado em 300 chars', async () => {
    respondWith(new Error('exit 1'), '', 'x'.repeat(1000))

    await expect(runCliBinary(INPUT)).rejects.toThrow(`CLI do Claude falhou: ${'x'.repeat(300)}`)
  })
})

describe('runCliBinary — auditoria em command_log', () => {
  let db: Database.Database

  beforeEach(() => {
    execFileMock.mockReset()
    db = new Database(':memory:')
    runMigrations(db)
    initAiRegistry({ db, getOpenRouterKey: () => null })
  })

  it('sucesso grava linha ok com o comando redigido e duração', async () => {
    respondWith(null, 'saída')
    await runCliBinary({ ...INPUT, args: ['-p', 'a'.repeat(400)] })

    const [entry] = listCommandLog(db)
    expect(entry.kind).toBe('cli')
    expect(entry.provider).toBe('claude')
    expect(entry.ok).toBe(true)
    expect(entry.error).toBeNull()
    expect(entry.command).toContain('/bin/fake-cli -p')
    expect(entry.command).toContain('(+100 chars)')
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('falha grava linha com ok=false e a mensagem do erro', async () => {
    respondWith(new Error('exit 1'), '', 'sem login')

    await expect(runCliBinary(INPUT)).rejects.toThrow()

    const [entry] = listCommandLog(db)
    expect(entry.ok).toBe(false)
    expect(entry.error).toBe('CLI do Claude falhou: sem login')
  })

  it('falha do log não derruba a execução', async () => {
    respondWith(null, 'saída')
    db.prepare('DROP TABLE command_log').run()

    await expect(runCliBinary(INPUT)).resolves.toBe('saída')
  })
})
