import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai = vi.hoisted(() => ({
  provider: null as { id: string; label: string } | null,
  run: null as null | ((feature: string, prompt: string) => Promise<string>)
}))

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())
vi.mock('../../ai/service', () => ({
  activeProvider: () => ai.provider,
  runAiPrompt: async (feature: string, prompt: string) => {
    if (!ai.run) throw new Error('runAiPrompt não configurado no teste')
    return ai.run(feature, prompt)
  }
}))

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { upsertSprints } = await import('../../db/repos/catalog')
const { registerSummaryHandlers } = await import('./summaries')

let t: ReturnType<typeof makeTestContext>

const PERIOD = { type: '7d' as const }

beforeEach(() => {
  ai.provider = null
  ai.run = async () => '# resumo da IA'
  t = makeTestContext()
  registerSummaryHandlers(t.ctx)
})

function seedActiveSprint(): void {
  upsertSprints(t.db, 1, [
    {
      jiraId: 77,
      boardJiraId: 1,
      name: 'Sprint atual',
      state: 'active',
      startDate: '2026-07-01T00:00:00.000Z',
      endDate: '2026-07-15T00:00:00.000Z',
      completeDate: null
    }
  ])
}

describe('summaries:generate', () => {
  it('useClaude false → markdown do template determinístico', async () => {
    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'standup',
      useClaude: false
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.generatedBy).toBe('template')
    expect(res.data.markdown.length).toBeGreaterThan(0)
  })

  it('useClaude true sem provider disponível cai no template', async () => {
    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'weekly',
      useClaude: true
    })
    expect(res.ok && res.data.generatedBy).toBe('template')
  })

  it('useClaude true com provider → markdown da IA e generatedBy do provider', async () => {
    ai.provider = { id: 'gemini', label: 'Gemini' }
    const prompts: string[] = []
    ai.run = async (_feature, prompt) => {
      prompts.push(prompt)
      return '# resumo enriquecido'
    }
    seedIssue(t.db, 'BT-1', { assignee_account_id: 'me-1' })

    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'standup',
      useClaude: true
    })
    expect(res.ok && res.data).toEqual({
      markdown: '# resumo enriquecido',
      generatedBy: 'gemini'
    })
    expect(prompts[0]).toContain('comentariosDoPeriodo')
  })

  it('falha da IA cai silenciosamente no template', async () => {
    ai.provider = { id: 'claude', label: 'Claude' }
    ai.run = async () => {
      throw new Error('CLI travou')
    }
    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'standup',
      useClaude: true
    })
    expect(res.ok && res.data.generatedBy).toBe('template')
  })

  it('período sprint resolve pela sprint ativa', async () => {
    seedActiveSprint()
    const res = await invokeHandler('summaries:generate', {
      period: { type: 'sprint' },
      template: 'standup',
      useClaude: false
    })
    expect(res.ok).toBe(true)
  })

  it('template desconhecido → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'inexistente',
      useClaude: false
    } as unknown as { period: typeof PERIOD; template: 'standup'; useClaude: boolean })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('summaries:generate', {
      period: PERIOD,
      template: 'standup',
      useClaude: false
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('summaries:sprintRetro', () => {
  it('sprint inexistente → NOT_FOUND', async () => {
    const res = await invokeHandler('summaries:sprintRetro', {
      sprintJiraId: 999,
      useClaude: false
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_FOUND')
  })

  it('sprint existente sem IA → template da retro', async () => {
    seedActiveSprint()
    const res = await invokeHandler('summaries:sprintRetro', {
      sprintJiraId: 77,
      useClaude: false
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.generatedBy).toBe('template')
    expect(res.data.markdown).toContain('Sprint atual')
  })

  it('com IA disponível → markdown enriquecido', async () => {
    seedActiveSprint()
    ai.provider = { id: 'codex', label: 'Codex' }
    ai.run = async () => '# retro enriquecida'
    const res = await invokeHandler('summaries:sprintRetro', {
      sprintJiraId: 77,
      useClaude: true
    })
    expect(res.ok && res.data).toEqual({ markdown: '# retro enriquecida', generatedBy: 'codex' })
  })

  it('falha da IA cai no template da retro', async () => {
    seedActiveSprint()
    ai.provider = { id: 'codex', label: 'Codex' }
    ai.run = async () => {
      throw new Error('sem rede')
    }
    const res = await invokeHandler('summaries:sprintRetro', {
      sprintJiraId: 77,
      useClaude: true
    })
    expect(res.ok && res.data.generatedBy).toBe('template')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('summaries:sprintRetro', {
      sprintJiraId: 77,
      useClaude: false
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('summaries:save / list / delete', () => {
  it('save grava e list devolve o resumo', async () => {
    const saved = await invokeHandler('summaries:save', {
      period: PERIOD,
      template: 'standup',
      contentMd: '# meu resumo',
      generatedBy: 'template'
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const list = await invokeHandler('summaries:list', {})
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.data.summaries).toHaveLength(1)
    expect(list.data.summaries[0]).toMatchObject({
      id: saved.data.id,
      template: 'standup',
      contentMd: '# meu resumo',
      generatedBy: 'template',
      periodType: '7d'
    })
  })

  it('delete remove o resumo salvo', async () => {
    const saved = await invokeHandler('summaries:save', {
      period: PERIOD,
      template: 'standup',
      contentMd: 'x',
      generatedBy: 'template'
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const res = await invokeHandler('summaries:delete', { id: saved.data.id })
    expect(res.ok && res.data).toEqual({ ok: true })

    const list = await invokeHandler('summaries:list', {})
    expect(list.ok && list.data.summaries).toEqual([])
  })

  it('list sem workspace → lista vazia em vez de erro', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('summaries:list', {})
    expect(res.ok && res.data.summaries).toEqual([])
  })

  it('save sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('summaries:save', {
      period: PERIOD,
      template: 'standup',
      contentMd: 'x',
      generatedBy: 'template'
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('delete sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('summaries:delete', { id: 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('generatedBy fora do enum → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('summaries:save', {
      period: PERIOD,
      template: 'standup',
      contentMd: 'x',
      generatedBy: 'chatgpt'
    } as unknown as {
      period: typeof PERIOD
      template: 'standup'
      contentMd: string
      generatedBy: 'template'
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
