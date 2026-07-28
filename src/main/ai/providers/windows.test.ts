import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { claudeCandidatePaths, claudeInvocation } = await import('./claude')
const { geminiCandidatePaths, geminiInvocation } = await import('./gemini')
const { codexCandidatePaths, codexInvocation } = await import('./codex')
const { isSafeModelId } = await import('../models')

/** Invocações e caminhos por plataforma (o prompt vai por stdin no Windows). */

const PROMPT = 'linha 1\nlinha 2 com "aspas" e acentos'

describe('claude', () => {
  it('unix: prompt no argv, stdin nulo', () => {
    const inv = claudeInvocation(PROMPT, 'sonnet', 'darwin')
    expect(inv.args).toEqual(['-p', PROMPT, '--output-format', 'json', '--model', 'sonnet'])
    expect(inv.stdinText).toBeNull()
  })

  it('win32: prompt via stdin, argv só com flags', () => {
    const inv = claudeInvocation(PROMPT, 'sonnet', 'win32')
    expect(inv.args).toEqual(['-p', '--output-format', 'json', '--model', 'sonnet'])
    expect(inv.stdinText).toBe(PROMPT)
  })

  it('win32: candidatos incluem o instalador nativo (.exe) e o shim do npm (.cmd)', () => {
    const paths = claudeCandidatePaths('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })
    expect(paths.some((p) => p.endsWith('claude.exe'))).toBe(true)
    expect(paths.some((p) => p.endsWith('claude.cmd') && p.includes('npm'))).toBe(true)
  })

  it('unix: candidatos continuam os de sempre', () => {
    const paths = claudeCandidatePaths('darwin', {})
    expect(paths).toContain('/opt/homebrew/bin/claude')
    expect(paths.every((p) => !p.endsWith('.exe'))).toBe(true)
  })
})

describe('gemini', () => {
  it('unix: prompt via -p no argv', () => {
    const inv = geminiInvocation(PROMPT, 'gemini-2.5-flash', 'darwin')
    expect(inv.args).toEqual(['-p', PROMPT, '-m', 'gemini-2.5-flash', '--output-format', 'json'])
    expect(inv.stdinText).toBeNull()
  })

  it('win32: sem -p — o CLI lê o prompt do stdin', () => {
    const inv = geminiInvocation(PROMPT, 'gemini-2.5-flash', 'win32')
    expect(inv.args).toEqual(['-m', 'gemini-2.5-flash', '--output-format', 'json'])
    expect(inv.stdinText).toBe(PROMPT)
  })

  it('win32: candidato é o shim do npm', () => {
    const paths = geminiCandidatePaths('win32', { APPDATA: 'C:\\AppData' })
    expect(paths).toHaveLength(1)
    expect(paths[0].endsWith('gemini.cmd')).toBe(true)
  })
})

describe('codex', () => {
  it('unix: prompt como argumento do exec', () => {
    const inv = codexInvocation(PROMPT, 'gpt-5.1', '/tmp/out.txt', 'darwin')
    expect(inv.args[0]).toBe('exec')
    expect(inv.args[1]).toBe(PROMPT)
    expect(inv.stdinText).toBeNull()
  })

  it('win32: `exec -` lê o prompt do stdin', () => {
    const inv = codexInvocation(PROMPT, 'gpt-5.1', 'C:\\tmp\\out.txt', 'win32')
    expect(inv.args.slice(0, 2)).toEqual(['exec', '-'])
    expect(inv.args).toContain('--output-last-message')
    expect(inv.stdinText).toBe(PROMPT)
  })

  it('win32: candidatos incluem npm (.cmd) e cargo (.exe)', () => {
    const paths = codexCandidatePaths('win32', { APPDATA: 'C:\\AppData' })
    expect(paths.some((p) => p.endsWith('codex.cmd') && p.includes('npm'))).toBe(true)
    expect(paths.some((p) => p.endsWith('codex.exe'))).toBe(true)
  })
})

describe('isSafeModelId', () => {
  it('aceita os ids reais de todos os providers', () => {
    for (const id of [
      'sonnet',
      'opus',
      'gemini-2.5-pro',
      'gpt-5.1-codex-max',
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-4.5:beta',
      'model@preset'
    ]) {
      expect(isSafeModelId(id)).toBe(true)
    }
  })

  it('rejeita metacaracteres de shell', () => {
    for (const id of ['a b', 'x;rm -rf', 'a&&b', 'a|b', 'a"b', "a'b", 'a`b', '']) {
      expect(isSafeModelId(id)).toBe(false)
    }
  })
})
