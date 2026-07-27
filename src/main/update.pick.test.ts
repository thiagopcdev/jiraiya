import { describe, expect, it, vi } from 'vitest'

// update.ts importa 'electron'. Sob ELECTRON_RUN_AS_NODE isso pode nem
// resolver como módulo — mockamos antes do import para garantir (mesmo padrão
// de update.test.ts).
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/fake'), getVersion: vi.fn(() => '1.0.0') }
}))

const { pickUpdateAsset } = await import('./update')

describe('pickUpdateAsset', () => {
  it('darwin escolhe o primeiro .dmg entre vários assets', () => {
    const assets = [
      { name: 'jiraiya-1.2.0.exe', apiUrl: 'url-exe' },
      { name: 'jiraiya-1.2.0.dmg.blockmap', apiUrl: 'url-blockmap' },
      { name: 'jiraiya-1.2.0.dmg', apiUrl: 'url-dmg' }
    ]
    expect(pickUpdateAsset(assets, 'darwin')).toEqual({
      name: 'jiraiya-1.2.0.dmg',
      apiUrl: 'url-dmg'
    })
  })

  it("win32 prefere '-setup.exe' sobre '.exe' genérico", () => {
    const assets = [
      { name: 'jiraiya-1.2.0.exe', apiUrl: 'url-generic' },
      { name: 'jiraiya-1.2.0-setup.exe', apiUrl: 'url-setup' }
    ]
    expect(pickUpdateAsset(assets, 'win32')).toEqual({
      name: 'jiraiya-1.2.0-setup.exe',
      apiUrl: 'url-setup'
    })
  })

  it("win32 sem '-setup.exe' cai no primeiro .exe", () => {
    const assets = [
      { name: 'jiraiya-1.2.0.exe', apiUrl: 'url-exe-1' },
      { name: 'jiraiya-1.2.0-other.exe', apiUrl: 'url-exe-2' }
    ]
    expect(pickUpdateAsset(assets, 'win32')).toEqual({
      name: 'jiraiya-1.2.0.exe',
      apiUrl: 'url-exe-1'
    })
  })

  it('darwin sem .dmg → null', () => {
    const assets = [
      { name: 'jiraiya-1.2.0.exe', apiUrl: 'url-exe' },
      { name: 'jiraiya-1.2.0-setup.exe', apiUrl: 'url-setup' }
    ]
    expect(pickUpdateAsset(assets, 'darwin')).toBeNull()
  })

  it('linux → null (sem asset suportado)', () => {
    const assets = [
      { name: 'jiraiya-1.2.0.dmg', apiUrl: 'url-dmg' },
      { name: 'jiraiya-1.2.0-setup.exe', apiUrl: 'url-setup' }
    ]
    expect(pickUpdateAsset(assets, 'linux')).toBeNull()
  })

  it('lista vazia → null', () => {
    expect(pickUpdateAsset([], 'darwin')).toBeNull()
  })

  it('não confunde .dmg.blockmap com .dmg', () => {
    const assets = [{ name: 'jiraiya-1.2.0.dmg.blockmap', apiUrl: 'url-blockmap' }]
    expect(pickUpdateAsset(assets, 'darwin')).toBeNull()
  })
})
