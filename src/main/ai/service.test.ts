import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { setPrefs } from '../db/repos/misc'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

/** Binários "instalados" no filesystem simulado; cada teste ajusta. */
const present = new Set<string>()
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return { ...real, existsSync: (p: string) => present.has(p) }
})

const { aiStatus, activeProvider, runAiPrompt } = await import('./service')
const { initAiRegistry, getProviders } = await import('./registry')

const CLAUDE_BIN = '/usr/local/bin/claude'
const GEMINI_BIN = '/usr/local/bin/gemini'

/** Faz o CLI mockado responder com o stdout dado. */
function cliReplies(stdout: string): void {
  execFileMock.mockImplementation(
    (
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, out: string, errOut: string) => void
    ) => {
      setTimeout(() => cb(null, stdout, ''), 0)
      return { stdin: { end: () => {} } }
    }
  )
}

function lastArgs(): string[] {
  const calls = execFileMock.mock.calls
  return calls[calls.length - 1][1] as string[]
}

let db: Database.Database

beforeEach(() => {
  execFileMock.mockReset()
  present.clear()
  db = new Database(':memory:')
  runMigrations(db)
  initAiRegistry({ db, getOpenRouterKey: () => null })
})

describe('initAiRegistry / getProviders', () => {
  it('instancia os 4 providers sempre na mesma ordem', () => {
    expect(getProviders().map((p) => p.id)).toEqual(['claude', 'gemini', 'codex', 'openrouter'])
  })

  it('reusa as instâncias entre chamadas (construção tardia única)', () => {
    expect(getProviders()[0]).toBe(getProviders()[0])
  })

  it('a chave do OpenRouter é lida pelo getter injetado no init', () => {
    initAiRegistry({ db, getOpenRouterKey: () => 'sk-x' })
    const openrouter = getProviders().find((p) => p.id === 'openrouter')
    expect(openrouter?.status()).toEqual({ available: true, detail: 'chave configurada' })
  })
})

describe('aiStatus', () => {
  it('sem nenhum provider disponível: lista completa, active null e pref auto', () => {
    const status = aiStatus()

    expect(status.activePref).toBe('auto')
    expect(status.active).toBeNull()
    expect(status.providers.map((p) => p.id)).toEqual(['claude', 'gemini', 'codex', 'openrouter'])
    expect(status.providers.every((p) => p.available === false)).toBe(true)
    expect(status.providers[0]).toMatchObject({
      label: 'Claude',
      kind: 'cli',
      detail: 'CLI do Claude não encontrado'
    })
    expect(status.providers[0].models.length).toBeGreaterThan(0)
  })

  it("em 'auto' elege o primeiro disponível na ordem de preferência", () => {
    present.add(GEMINI_BIN)
    const status = aiStatus()

    expect(status.active).toEqual({ id: 'gemini', label: 'Gemini' })
    expect(status.providers.find((p) => p.id === 'gemini')?.available).toBe(true)
  })

  it('pref explícito indisponível → active null, sem cair para outro', () => {
    present.add(CLAUDE_BIN)
    setPrefs(db, { aiProvider: 'codex' })

    const status = aiStatus()
    expect(status.activePref).toBe('codex')
    expect(status.active).toBeNull()
  })

  it('pref explícito disponível é respeitado mesmo com outro antes na ordem', () => {
    present.add(CLAUDE_BIN)
    present.add(GEMINI_BIN)
    setPrefs(db, { aiProvider: 'gemini' })

    expect(aiStatus().active).toEqual({ id: 'gemini', label: 'Gemini' })
  })
})

describe('activeProvider', () => {
  it('devolve null quando nada está disponível', () => {
    expect(activeProvider()).toBeNull()
  })

  it('devolve o provider eleito', () => {
    present.add(CLAUDE_BIN)
    expect(activeProvider()?.id).toBe('claude')
  })
})

describe('runAiPrompt', () => {
  it('sem provider disponível lança AiUnavailableError explicando o caminho', async () => {
    await expect(runAiPrompt('summaries', 'oi')).rejects.toThrow(
      'Nenhum provider de IA disponível — configure em Ajustes'
    )
  })

  it('usa o provider ativo e o modelo default da função', async () => {
    present.add(CLAUDE_BIN)
    cliReplies(JSON.stringify({ result: 'texto' }))

    await expect(runAiPrompt('split', 'divida esse card')).resolves.toBe('texto')
    expect(lastArgs()).toEqual([
      '-p',
      'divida esse card',
      '--output-format',
      'json',
      '--model',
      'opus'
    ])
  })

  it('respeita o modelo escolhido em aiModels para a função', async () => {
    present.add(CLAUDE_BIN)
    setPrefs(db, { aiModels: { claude: { summaries: 'haiku' } } })
    cliReplies(JSON.stringify({ result: 'texto' }))

    await runAiPrompt('summaries', 'resuma')
    expect(lastArgs()).toContain('haiku')
  })

  it('remove a cerca de código que o modelo costuma embalar na resposta', async () => {
    present.add(CLAUDE_BIN)
    cliReplies(JSON.stringify({ result: '```markdown\n# Título\n\ntexto\n```' }))

    await expect(runAiPrompt('summaries', 'resuma')).resolves.toBe('# Título\n\ntexto')
  })

  it('propaga a falha do provider', async () => {
    present.add(CLAUDE_BIN)
    cliReplies('lixo que não é json')

    await expect(runAiPrompt('comment', 'reescreva')).rejects.toThrow(
      'Resposta do CLI em formato inesperado'
    )
  })
})
