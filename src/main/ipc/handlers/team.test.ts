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
const { registerTeamHandlers } = await import('./team')

let t: ReturnType<typeof makeTestContext>

const PERIOD = { type: '30d' as const }

beforeEach(() => {
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run = async () => '# panorama'
  t = makeTestContext()
  registerTeamHandlers(t.ctx)
})

/** Membro do time descoberto por assignee de card aberto. */
function seedMember(key: string, accountId: string, name: string): void {
  seedIssue(t.db, key, {
    assignee_account_id: accountId,
    assignee_name: name,
    status: 'Em andamento',
    status_category: 'indeterminate'
  })
}

describe('team:summary', () => {
  it('sem atividade → nenhum membro, mas devolve rótulo e modo de sync', async () => {
    const res = await invokeHandler('team:summary', { period: PERIOD })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.members).toEqual([])
    expect(res.data.periodLabel.length).toBeGreaterThan(0)
    expect(res.data.syncMode).toBe('project')
  })

  it('descobre membros pelos cards abertos e marca isMe', async () => {
    seedMember('BT-1', 'me-1', 'Eu Mesmo')
    seedMember('BT-2', 'acc-2', 'Colega')

    const res = await invokeHandler('team:summary', { period: PERIOD })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // "eu" sempre no fim — o foco da tela é o resto do time
    expect(res.data.members.map((m) => m.name)).toEqual(['Colega', 'Eu Mesmo'])
    expect(res.data.members.at(-1)?.isMe).toBe(true)
  })

  it('período inválido → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('team:summary', {
      period: { type: 'decada' }
    } as unknown as { period: typeof PERIOD })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('team:summary', { period: PERIOD })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('team:narrative', () => {
  it('IA responde → ok true com o markdown', async () => {
    seedMember('BT-2', 'acc-2', 'Colega')
    const prompts: string[] = []
    ai.run = async (_feature, prompt) => {
      prompts.push(prompt)
      return '**Colega** está em BT-2.'
    }

    const res = await invokeHandler('team:narrative', { period: PERIOD })
    expect(res.ok && res.data).toEqual({ ok: true, markdown: '**Colega** está em BT-2.' })
    expect(prompts[0]).toContain('Colega')
  })

  it('IA falha → ok false com aviso citando o provider', async () => {
    ai.run = async () => {
      throw new Error('CLI ausente')
    }
    const res = await invokeHandler('team:narrative', { period: PERIOD })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.ok).toBe(false)
    expect(res.data.markdown).toBe('Claude indisponível — mostrando apenas o radar do time.')
  })

  it('IA falha e nenhum provider ativo → aviso genérico "IA"', async () => {
    ai.provider = null
    ai.run = async () => {
      throw new Error('nada disponível')
    }
    const res = await invokeHandler('team:narrative', { period: PERIOD })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.markdown).toBe('IA indisponível — mostrando apenas o radar do time.')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('team:narrative', { period: PERIOD })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('team:velocity', () => {
  it('sem sprints → zeros', async () => {
    const res = await invokeHandler('team:velocity', {})
    expect(res.ok && res.data).toEqual({
      sprints: [],
      totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 }
    })
  })

  it('conta os pontos entregues na janela da sprint', async () => {
    upsertSprints(t.db, 1, [
      {
        jiraId: 10,
        boardJiraId: 1,
        name: 'Sprint 1',
        state: 'closed',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-15T00:00:00.000Z',
        completeDate: '2026-06-15T00:00:00.000Z'
      }
    ])
    seedIssue(t.db, 'BT-1', {
      assignee_account_id: 'me-1',
      story_points: 5,
      resolved_at: '2026-06-10T00:00:00.000Z'
    })

    const res = await invokeHandler('team:velocity', { sprintCount: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.sprints).toHaveLength(1)
    expect(res.data.totals.myPoints).toBe(5)
  })

  it('sprintCount fora do range → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('team:velocity', { sprintCount: 1 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('team:velocity', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
