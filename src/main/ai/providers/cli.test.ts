import { statSync, writeFileSync } from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiUnavailableError } from '../types'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

/** Caminhos que "existem" no filesystem simulado; cada teste ajusta. */
const present = new Set<string>()
vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>()
  return { ...real, existsSync: (p: string) => present.has(p) }
})

const { createClaudeProvider } = await import('./claude')
const { createGeminiProvider } = await import('./gemini')
const { createCodexProvider } = await import('./codex')

type ExecArgs = string[]

/** Faz o execFile mockado responder com stdout/stderr fixos. */
function cliReplies(stdout: string, err: Error | null = null, stderr = ''): void {
  execFileMock.mockImplementation(
    (
      _bin: string,
      _args: ExecArgs,
      _opts: unknown,
      cb: (e: Error | null, out: string, errOut: string) => void
    ) => {
      setTimeout(() => cb(err, stdout, stderr), 0)
      return { stdin: { end: () => {} } }
    }
  )
}

function argsOf(callIndex = 0): ExecArgs {
  return execFileMock.mock.calls[callIndex][1] as ExecArgs
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  execFileMock.mockReset()
  present.clear()
})

describe('provider claude', () => {
  const provider = createClaudeProvider()

  it('metadados: id, label, kind e catálogo curado', () => {
    expect(provider.id).toBe('claude')
    expect(provider.label).toBe('Claude')
    expect(provider.kind).toBe('cli')
    expect(provider.models().map((m) => m.id)).toEqual(['haiku', 'sonnet', 'opus'])
  })

  it('defaultModel: opus para split/ask, sonnet no resto', () => {
    expect(provider.defaultModel('split')).toBe('opus')
    expect(provider.defaultModel('ask')).toBe('opus')
    expect(provider.defaultModel('summaries')).toBe('sonnet')
  })

  it('status indisponível quando nenhum binário existe', () => {
    expect(provider.status()).toEqual({
      available: false,
      detail: 'CLI do Claude não encontrado'
    })
  })

  it('status disponível traz o caminho encontrado como detalhe', () => {
    present.add('/opt/homebrew/bin/claude')
    expect(provider.status()).toEqual({ available: true, detail: '/opt/homebrew/bin/claude' })
  })

  it('run sem binário falha com AiUnavailableError e não executa nada', async () => {
    await expect(provider.run('oi', 'sonnet')).rejects.toBeInstanceOf(AiUnavailableError)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('run monta os args do modo -p json e devolve o result parseado', async () => {
    present.add('/usr/local/bin/claude')
    cliReplies(JSON.stringify({ result: '  resposta  ' }))

    await expect(provider.run('prompt aqui', 'haiku')).resolves.toBe('resposta')
    expect(execFileMock.mock.calls[0][0]).toBe('/usr/local/bin/claude')
    expect(argsOf()).toEqual(['-p', 'prompt aqui', '--output-format', 'json', '--model', 'haiku'])
  })

  it('run propaga erro de envelope inválido do CLI', async () => {
    present.add('/usr/local/bin/claude')
    cliReplies('não é json')

    await expect(provider.run('oi', 'haiku')).rejects.toThrow(
      'Resposta do CLI em formato inesperado'
    )
  })
})

describe('provider gemini', () => {
  const provider = createGeminiProvider()

  it('metadados e defaults por função', () => {
    expect(provider.id).toBe('gemini')
    expect(provider.label).toBe('Gemini')
    expect(provider.kind).toBe('cli')
    expect(provider.models().map((m) => m.id)).toContain('gemini-2.5-flash')
    expect(provider.defaultModel('split')).toBe('gemini-2.5-pro')
    expect(provider.defaultModel('comment')).toBe('gemini-2.5-flash')
  })

  it('status sem binário e com binário', () => {
    expect(provider.status().available).toBe(false)
    present.add('/opt/homebrew/bin/gemini')
    expect(provider.status()).toEqual({ available: true, detail: '/opt/homebrew/bin/gemini' })
  })

  it('run sem binário falha', async () => {
    await expect(provider.run('oi', 'gemini-2.5-flash')).rejects.toThrow(
      'CLI do Gemini não encontrado'
    )
  })

  it('run monta args -p/-m e devolve response do envelope', async () => {
    present.add('/opt/homebrew/bin/gemini')
    cliReplies(JSON.stringify({ response: 'olá' }))

    await expect(provider.run('pergunta', 'gemini-2.5-pro')).resolves.toBe('olá')
    expect(argsOf()).toEqual(['-p', 'pergunta', '-m', 'gemini-2.5-pro', '--output-format', 'json'])
  })

  it('run com stdout de texto puro (CLI antigo) devolve o texto', async () => {
    present.add('/opt/homebrew/bin/gemini')
    cliReplies('resposta em texto puro\n')

    await expect(provider.run('oi', 'gemini-2.5-flash')).resolves.toBe('resposta em texto puro')
  })
})

describe('provider codex', () => {
  const provider = createCodexProvider()

  /** Simula o codex: escreve a resposta no arquivo de --output-last-message. */
  function codexWrites(content: string | null, err: Error | null = null): { outFile: string } {
    const captured = { outFile: '' }
    execFileMock.mockImplementation(
      (
        _bin: string,
        args: ExecArgs,
        _opts: unknown,
        cb: (e: Error | null, out: string, errOut: string) => void
      ) => {
        const idx = args.indexOf('--output-last-message')
        captured.outFile = args[idx + 1]
        if (content !== null) writeFileSync(captured.outFile, content, 'utf8')
        setTimeout(() => cb(err, 'log de execução ruidoso', ''), 0)
        return { stdin: { end: () => {} } }
      }
    )
    return captured
  }

  it('metadados e defaults por função', () => {
    expect(provider.id).toBe('codex')
    expect(provider.label).toBe('Codex')
    expect(provider.kind).toBe('cli')
    expect(provider.models().map((m) => m.id)).toContain('gpt-5.1')
    expect(provider.defaultModel('split')).toBe('gpt-5.1-codex-max')
    expect(provider.defaultModel('draft')).toBe('gpt-5.1-codex-mini')
  })

  it('status indisponível sem binário', () => {
    expect(provider.status()).toEqual({ available: false, detail: 'CLI do Codex não encontrado' })
  })

  it('status disponível com o primeiro candidato', () => {
    present.add('/opt/homebrew/bin/codex')
    present.add('/usr/local/bin/codex')
    expect(provider.status()).toEqual({ available: true, detail: '/opt/homebrew/bin/codex' })
  })

  it('run sem binário falha', async () => {
    await expect(provider.run('oi', 'gpt-5.1')).rejects.toThrow('CLI do Codex não encontrado')
  })

  it('run lê a resposta do arquivo temporário (não do stdout) e apaga o arquivo', async () => {
    present.add('/usr/local/bin/codex')
    const captured = codexWrites('  resposta do codex  \n')

    await expect(provider.run('prompt', 'gpt-5.1')).resolves.toBe('resposta do codex')
    expect(captured.outFile).toMatch(/jiraiya-codex-.*\.txt$/)
    expect(exists(captured.outFile)).toBe(false)
  })

  it('run passa exec, sandbox read-only e skip-git-repo-check', async () => {
    present.add('/usr/local/bin/codex')
    codexWrites('ok')
    await provider.run('prompt', 'gpt-5.1-codex-max')

    const args = argsOf()
    expect(args.slice(0, 6)).toEqual([
      'exec',
      'prompt',
      '-m',
      'gpt-5.1-codex-max',
      '--sandbox',
      'read-only'
    ])
    expect(args).toContain('--skip-git-repo-check')
  })

  it('arquivo não escrito pelo CLI → resposta vazia', async () => {
    present.add('/usr/local/bin/codex')
    codexWrites(null)

    await expect(provider.run('prompt', 'gpt-5.1')).rejects.toThrow('Codex retornou resposta vazia')
  })

  it('arquivo escrito só com espaços → resposta vazia', async () => {
    present.add('/usr/local/bin/codex')
    codexWrites('   \n  ')

    await expect(provider.run('prompt', 'gpt-5.1')).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('falha do CLI apaga o arquivo temporário mesmo assim', async () => {
    present.add('/usr/local/bin/codex')
    const captured = codexWrites('parcial', new Error('exit 1'))

    await expect(provider.run('prompt', 'gpt-5.1')).rejects.toThrow('CLI do Codex falhou')
    expect(exists(captured.outFile)).toBe(false)
  })
})
