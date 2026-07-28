import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ execFile: execFileMock }))

const { findInPath, isWindowsShim, runCliBinary } = await import('./exec')

/**
 * Resolução multiplataforma de binários. Os cenários "win32" rodam em qualquer
 * SO: só dependem de nomes de arquivo e do separador do PATH injetado.
 */

const dirA = mkdtempSync(join(tmpdir(), 'jiraiya-path-a-'))
const dirB = mkdtempSync(join(tmpdir(), 'jiraiya-path-b-'))
afterAll(() => {
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
})

describe('findInPath', () => {
  it('unix: acha o binário sem extensão no PATH', () => {
    writeFileSync(join(dirA, 'claude'), '#!/bin/sh')
    expect(findInPath('claude', { PATH: `${dirB}:${dirA}` }, 'darwin')).toBe(join(dirA, 'claude'))
  })

  it('unix: null quando não existe', () => {
    expect(findInPath('naoexiste', { PATH: dirA }, 'linux')).toBeNull()
  })

  it('win32: acha .exe e .cmd usando PATHEXT e separador ;', () => {
    writeFileSync(join(dirA, 'gemini.cmd'), '@echo off')
    writeFileSync(join(dirB, 'codex.exe'), 'MZ')
    const env = { PATH: `${dirA};${dirB}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    expect(findInPath('gemini', env, 'win32')).toBe(join(dirA, 'gemini.cmd'))
    expect(findInPath('codex', env, 'win32')).toBe(join(dirB, 'codex.exe'))
  })

  it('win32: PATHEXT ausente cai no default exe/cmd/bat', () => {
    writeFileSync(join(dirA, 'gh.exe'), 'MZ')
    expect(findInPath('gh', { PATH: dirA }, 'win32')).toBe(join(dirA, 'gh.exe'))
  })

  it('win32: ignora extensões do PATHEXT que exigem interpretador (.ps1, .js)', () => {
    writeFileSync(join(dirB, 'tool.ps1'), 'Write-Host')
    expect(findInPath('tool', { PATH: dirB, PATHEXT: '.PS1;.JS' }, 'win32')).toBeNull()
  })

  it('PATH vazio/ausente → null', () => {
    expect(findInPath('claude', {}, 'win32')).toBeNull()
    expect(findInPath('claude', {}, 'darwin')).toBeNull()
  })
})

describe('isWindowsShim', () => {
  it('reconhece .cmd/.bat (case-insensitive) e nada mais', () => {
    expect(isWindowsShim('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd')).toBe(true)
    expect(isWindowsShim('C:\\tools\\run.BAT')).toBe(true)
    expect(isWindowsShim('C:\\Users\\x\\.local\\bin\\claude.exe')).toBe(false)
    expect(isWindowsShim('/usr/local/bin/claude')).toBe(false)
  })
})

describe('runCliBinary — modo Windows', () => {
  function fakeChild(): {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  } {
    return { stdin: { write: vi.fn(), end: vi.fn() } }
  }

  it('escreve o prompt no stdin quando stdinText é passado', async () => {
    const child = fakeChild()
    execFileMock.mockImplementationOnce((_f, _a, _o, cb) => {
      queueMicrotask(() => cb(null, 'ok', ''))
      return child
    })
    const out = await runCliBinary({
      binary: '/usr/local/bin/claude',
      args: ['-p'],
      stdinText: 'prompt multilinha\ncom acentos',
      label: 'Claude',
      provider: 'claude'
    })
    expect(out).toBe('ok')
    expect(child.stdin.write).toHaveBeenCalledWith('prompt multilinha\ncom acentos')
    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('shim .cmd roda com shell e caminho entre aspas', async () => {
    const child = fakeChild()
    let file = ''
    let opts: { shell?: boolean } = {}
    execFileMock.mockImplementationOnce((f, _a, o, cb) => {
      file = f as string
      opts = o as { shell?: boolean }
      queueMicrotask(() => cb(null, 'ok', ''))
      return child
    })
    await runCliBinary({
      binary: 'C:\\Users\\John Doe\\AppData\\Roaming\\npm\\claude.cmd',
      args: ['-p'],
      stdinText: 'oi',
      label: 'Claude',
      provider: 'claude'
    })
    expect(opts.shell).toBe(true)
    expect(file).toBe('"C:\\Users\\John Doe\\AppData\\Roaming\\npm\\claude.cmd"')
  })

  it('binário comum roda sem shell e sem aspas', async () => {
    const child = fakeChild()
    let file = ''
    let opts: { shell?: boolean } = {}
    execFileMock.mockImplementationOnce((f, _a, o, cb) => {
      file = f as string
      opts = o as { shell?: boolean }
      queueMicrotask(() => cb(null, 'ok', ''))
      return child
    })
    await runCliBinary({
      binary: '/opt/homebrew/bin/claude',
      args: ['-p', 'oi'],
      label: 'Claude',
      provider: 'claude'
    })
    expect(opts.shell).toBe(false)
    expect(file).toBe('/opt/homebrew/bin/claude')
    expect(child.stdin.write).not.toHaveBeenCalled()
  })
})
