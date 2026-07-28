import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResponse } from '@shared/ipc-contract'

const openrouter = vi.hoisted(() => ({
  keyValid: true,
  models: [{ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }],
  modelsError: null as Error | null,
  refreshCalls: [] as Array<boolean | undefined>
}))

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const AI_STATUS: IpcResponse<'ai:status'> = {
  providers: [
    {
      id: 'claude',
      label: 'Claude',
      kind: 'cli',
      available: true,
      detail: '/opt/homebrew/bin/claude',
      models: [{ id: 'sonnet', label: 'Sonnet' }]
    }
  ],
  active: { id: 'claude', label: 'Claude' },
  activePref: 'auto'
}

vi.mock('../../ai/service', () => ({ aiStatus: () => AI_STATUS }))
vi.mock('../../ai/providers/openrouter', () => ({
  validateOpenRouterKey: async () => openrouter.keyValid,
  listOpenRouterModels: async (_key: string, refresh?: boolean) => {
    openrouter.refreshCalls.push(refresh)
    if (openrouter.modelsError) throw openrouter.modelsError
    return openrouter.models
  }
}))

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { getCredential, storeCredential } = await import('../../security/credentials')
const { logCommand } = await import('../../db/repos/commandLog')
const { registerAiHandlers } = await import('./ai')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  openrouter.keyValid = true
  openrouter.modelsError = null
  openrouter.refreshCalls = []
  t = makeTestContext()
  registerAiHandlers(t.ctx)
})

describe('ai:status', () => {
  it('repassa o snapshot do registry de IA', async () => {
    const res = await invokeHandler('ai:status', {})
    expect(res.ok && res.data).toEqual(AI_STATUS)
  })
})

describe('ai:setOpenRouterKey', () => {
  it('key válida é gravada criptografada no keychain', async () => {
    const res = await invokeHandler('ai:setOpenRouterKey', { key: 'sk-or-abc' })
    expect(res.ok && res.data).toEqual({ ok: true })
    expect(getCredential(t.db, 1, 'openrouter_api_key')).toBe('sk-or-abc')
  })

  it('regravar substitui a anterior (não acumula linhas)', async () => {
    await invokeHandler('ai:setOpenRouterKey', { key: 'sk-1' })
    await invokeHandler('ai:setOpenRouterKey', { key: 'sk-2' })
    expect(getCredential(t.db, 1, 'openrouter_api_key')).toBe('sk-2')
    const row = t.db
      .prepare(`SELECT COUNT(*) AS n FROM integration_credential WHERE type = 'openrouter_api_key'`)
      .get() as { n: number }
    expect(row.n).toBe(1)
  })

  it('key recusada pelo OpenRouter → OPENROUTER_ERROR e nada é gravado', async () => {
    openrouter.keyValid = false
    const res = await invokeHandler('ai:setOpenRouterKey', { key: 'sk-ruim' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('OPENROUTER_ERROR')
    expect(getCredential(t.db, 1, 'openrouter_api_key')).toBeNull()
  })

  it('key vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('ai:setOpenRouterKey', { key: '   ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('ai:setOpenRouterKey', { key: 'sk-or-abc' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('ai:clearOpenRouterKey', () => {
  it('apaga só a key do OpenRouter e preserva o token do Jira', async () => {
    storeCredential(t.db, 1, 'jira_api_token', 'tok-jira')
    await invokeHandler('ai:setOpenRouterKey', { key: 'sk-or-abc' })

    const res = await invokeHandler('ai:clearOpenRouterKey', {})
    expect(res.ok && res.data).toEqual({ ok: true })
    expect(getCredential(t.db, 1, 'openrouter_api_key')).toBeNull()
    expect(getCredential(t.db, 1, 'jira_api_token')).toBe('tok-jira')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('ai:clearOpenRouterKey', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('ai:openrouterModels', () => {
  it('sem key configurada → OPENROUTER_ERROR', async () => {
    const res = await invokeHandler('ai:openrouterModels', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('OPENROUTER_ERROR')
    expect(res.message).toContain('Ajustes')
  })

  it('com key devolve o catálogo e repassa o refresh', async () => {
    await invokeHandler('ai:setOpenRouterKey', { key: 'sk-or-abc' })

    const res = await invokeHandler('ai:openrouterModels', { refresh: true })
    expect(res.ok && res.data.models).toEqual(openrouter.models)
    expect(openrouter.refreshCalls).toEqual([true])
  })

  it('falha da API do OpenRouter sobe como INTERNAL', async () => {
    await invokeHandler('ai:setOpenRouterKey', { key: 'sk-or-abc' })
    openrouter.modelsError = new Error('HTTP 500')

    const res = await invokeHandler('ai:openrouterModels', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INTERNAL')
  })

  it('sem workspace → OPENROUTER_ERROR (não há onde buscar a key)', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('ai:openrouterModels', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('OPENROUTER_ERROR')
  })
})

describe('commandLog', () => {
  it('list devolve as entradas mais recentes primeiro', async () => {
    logCommand(t.db, {
      kind: 'cli',
      provider: 'claude',
      feature: 'ask',
      command: 'claude -p …',
      durationMs: 1200,
      ok: true,
      error: null
    })
    logCommand(t.db, {
      kind: 'http',
      provider: 'openrouter',
      feature: 'draft',
      command: 'POST /chat/completions',
      durationMs: null,
      ok: false,
      error: 'HTTP 429'
    })

    const res = await invokeHandler('commandLog:list', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.entries.map((e) => e.provider)).toEqual(['openrouter', 'claude'])
    expect(res.data.entries[0]).toMatchObject({
      kind: 'http',
      ok: false,
      error: 'HTTP 429',
      durationMs: null
    })
  })

  it('clear zera o histórico', async () => {
    logCommand(t.db, {
      kind: 'cli',
      provider: 'claude',
      feature: null,
      command: 'claude -p …',
      durationMs: 1,
      ok: true,
      error: null
    })

    const res = await invokeHandler('commandLog:clear', {})
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('commandLog:list', {})
    expect(list.ok && list.data.entries).toEqual([])
  })
})
