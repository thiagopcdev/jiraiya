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
const { AiUnavailableError } = await import('../../ai/types')
const { registerRiskHandlers } = await import('./risk')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run = async () => '# análise de risco'
  t = makeTestContext()
  registerRiskHandlers(t.ctx)
})

function seedActiveSprint(startDate = '2026-07-01T00:00:00.000Z'): void {
  upsertSprints(t.db, 1, [
    {
      jiraId: 77,
      boardJiraId: 1,
      name: 'Sprint atual',
      state: 'active',
      startDate,
      endDate: '2026-08-01T00:00:00.000Z',
      completeDate: null
    }
  ])
}

/** Card no escopo da sprint, em andamento e sem estimativa (gera sinal). */
function seedRiskyIssue(key: string): void {
  seedIssue(t.db, key, {
    sprint_jira_id: 77,
    status: 'Em andamento',
    status_category: 'indeterminate',
    assignee_account_id: 'me-1',
    assignee_name: 'Eu Mesmo',
    story_points: null,
    updated_at: '2026-07-02T00:00:00.000Z'
  })
}

describe('sprint:risk', () => {
  it('sem sprint ativa → sprint null e nenhum item', async () => {
    const res = await invokeHandler('sprint:risk', {})
    expect(res.ok && res.data).toEqual({ sprint: null, items: [] })
  })

  it('cards do escopo com sinais aparecem com score e sinais', async () => {
    seedActiveSprint()
    seedRiskyIssue('BT-1')

    const res = await invokeHandler('sprint:risk', {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.sprint).toEqual({ jiraId: 77, name: 'Sprint atual' })
    expect(res.data.items).toHaveLength(1)
    expect(res.data.items[0].issue.key).toBe('BT-1')
    expect(res.data.items[0].signals).toContain('sem estimativa')
    expect(res.data.items[0].score).toBeGreaterThan(0)
  })

  it('card concluído do escopo é ignorado', async () => {
    seedActiveSprint()
    seedIssue(t.db, 'BT-9', {
      sprint_jira_id: 77,
      status: 'Concluído',
      status_category: 'done',
      story_points: null
    })

    const res = await invokeHandler('sprint:risk', {})
    expect(res.ok && res.data.items).toEqual([])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('sprint:risk', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('sprint:riskExplain', () => {
  it('monta o prompt com as keys em risco e devolve o markdown da IA', async () => {
    seedActiveSprint()
    seedRiskyIssue('BT-1')
    const prompts: string[] = []
    ai.run = async (_feature, prompt) => {
      prompts.push(prompt)
      return '## BT-1 em risco'
    }

    const res = await invokeHandler('sprint:riskExplain', {})
    expect(res.ok && res.data).toEqual({ markdown: '## BT-1 em risco', generatedBy: 'claude' })
    expect(prompts[0]).toContain('BT-1')
    expect(prompts[0]).toContain('COMENTÁRIOS RECENTES')
  })

  it('sprint sem data de início → sem comentários no prompt, mas ainda explica', async () => {
    const res = await invokeHandler('sprint:riskExplain', {})
    expect(res.ok && res.data.generatedBy).toBe('claude')
  })

  it('sem provider de IA → AI_UNAVAILABLE', async () => {
    ai.provider = null
    const res = await invokeHandler('sprint:riskExplain', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
    expect(res.message).toContain('Ajustes')
  })

  it('falha da IA → AI_UNAVAILABLE com a mensagem original', async () => {
    ai.run = async () => {
      throw new AiUnavailableError('timeout do modelo')
    }
    const res = await invokeHandler('sprint:riskExplain', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
    expect(res.message).toBe('timeout do modelo')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('sprint:riskExplain', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
