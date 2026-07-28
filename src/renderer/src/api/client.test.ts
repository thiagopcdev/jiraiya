// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installMockApi, MockIpcFailure } from '../testing/mockApi'
import { invoke, IpcError } from './client'

describe('invoke', () => {
  it('desembrulha o envelope {ok:true} e retorna data', async () => {
    installMockApi({ 'prefs:get': () => ({ theme: 'dark' }) as never })
    const result = await invoke('prefs:get', {})
    expect(result).toEqual({ theme: 'dark' })
  })

  it('lança IpcError com code e message quando ok:false (MockIpcFailure)', async () => {
    installMockApi({
      'prefs:get': () => {
        throw new MockIpcFailure('BUSY', 'Ocupado agora')
      }
    })
    await expect(invoke('prefs:get', {})).rejects.toMatchObject({
      name: 'IpcError',
      code: 'BUSY',
      message: 'Ocupado agora'
    })
  })

  it('canal sem handler registrado gera IpcError NO_MOCK', async () => {
    installMockApi()
    await expect(invoke('prefs:get', {})).rejects.toBeInstanceOf(IpcError)
    try {
      await invoke('prefs:get', {})
      throw new Error('não deveria chegar aqui')
    } catch (err) {
      expect(err).toBeInstanceOf(IpcError)
      expect((err as IpcError).code).toBe('NO_MOCK')
    }
  })

  it('propaga o payload exato para window.api.invoke', async () => {
    const api = installMockApi({ 'alerts:dismiss': () => ({ ok: true }) as never })
    await invoke('alerts:dismiss', { id: 42 })
    expect(api.lastPayload('alerts:dismiss')).toEqual({ id: 42 })
  })
})
