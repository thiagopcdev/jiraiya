import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerIssueHandlers, resolveWithSprint } = await import('./issues')
const { upsertSprints } = await import('../../db/repos/catalog')
const { insertActivities } = await import('../../db/repos/activity')

type Ctx = ReturnType<typeof makeTestContext>
type Fake = Record<string, unknown>

function client(methods: Fake): Partial<JiraClient> {
  return methods as unknown as Partial<JiraClient>
}

function ok<C extends IpcChannel>(res: IpcResult<C>): IpcResponse<C> {
  if (!res.ok) throw new Error(`esperava ok, veio ${res.code}: ${res.message}`)
  return res.data
}

function err<C extends IpcChannel>(res: IpcResult<C>): { code: string; message: string } {
  if (res.ok) throw new Error('esperava erro, veio ok')
  return { code: res.code, message: res.message }
}

function setup(methods: Fake = {}): Ctx {
  const t = makeTestContext({ client: client(methods) })
  registerIssueHandlers(t.ctx)
  return t
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

beforeEach(() => {
  resetElectronMock()
})

describe('issues:query', () => {
  it('bucket mine devolve meus cards abertos', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1', { assignee_account_id: 'me-1' })
    seedIssue(t.db, 'ABC-2', { assignee_account_id: 'outro' })
    seedIssue(t.db, 'ABC-3', { assignee_account_id: 'me-1', status_category: 'done' })

    const data = ok(await invokeHandler('issues:query', { period: { type: '7d' }, bucket: 'mine' }))

    expect(data.issues.map((i) => i.key)).toEqual(['ABC-1'])
    expect(data.issues[0].url).toBe('https://x.atlassian.net/browse/ABC-1')
  })

  it('sem bucket cai em "all" (dentro do período)', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1', { updated_at: nowIso(-3600_000) })
    seedIssue(t.db, 'ABC-2', { updated_at: '2020-01-01T00:00:00.000Z' })

    const data = ok(await invokeHandler('issues:query', { period: { type: '7d' } }))
    expect(data.issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('período sprint usa a sprint ativa', async () => {
    const t = setup()
    upsertSprints(t.db, 1, [
      {
        jiraId: 70,
        boardJiraId: 1,
        name: 'Sprint 70',
        state: 'active',
        startDate: nowIso(-86400_000),
        endDate: nowIso(86400_000),
        completeDate: null
      }
    ])
    seedIssue(t.db, 'ABC-1', { sprint_jira_id: 70 })

    const data = ok(
      await invokeHandler('issues:query', { period: { type: 'sprint' }, bucket: 'sprintScope' })
    )
    expect(data.issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup()
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('issues:query', { period: { type: '7d' } })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('período fora do enum → INVALID_PAYLOAD', async () => {
    setup()
    const bad = { period: { type: 'decada' } } as unknown as Parameters<
      typeof invokeHandler<'issues:query'>
    >[1]
    expect(err(await invokeHandler('issues:query', bad)).code).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:get', () => {
  it('devolve o card do cache com a URL montada', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1', { labels_json: '["bug"]', flagged: 1 })

    const data = ok(await invokeHandler('issues:get', { key: ' abc-1 ' }))

    expect(data.issue).toMatchObject({
      key: 'ABC-1',
      labels: ['bug'],
      flagged: true,
      url: 'https://x.atlassian.net/browse/ABC-1'
    })
  })

  it('card inexistente → null', async () => {
    setup()
    expect(ok(await invokeHandler('issues:get', { key: 'ABC-9' })).issue).toBeNull()
  })
})

describe('issues:children', () => {
  it('lista os filhos ordenados por key', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1')
    seedIssue(t.db, 'ABC-3', { parent_key: 'ABC-1' })
    seedIssue(t.db, 'ABC-2', { parent_key: 'ABC-1' })
    seedIssue(t.db, 'ABC-4', { parent_key: 'ABC-9' })

    const data = ok(await invokeHandler('issues:children', { key: 'abc-1' }))
    expect(data.issues.map((i) => i.key)).toEqual(['ABC-2', 'ABC-3'])
  })

  it('sem filhos → lista vazia', async () => {
    setup()
    expect(ok(await invokeHandler('issues:children', { key: 'ABC-1' })).issues).toEqual([])
  })
})

describe('issues:links', () => {
  it('mapeia links outward e inward', async () => {
    const issueLinks = vi.fn(async () => [
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        outwardIssue: {
          key: 'ABC-2',
          fields: {
            summary: 'Outro card',
            status: { name: 'Pronto', statusCategory: { key: 'done' } }
          }
        }
      },
      {
        type: { name: 'Relates', inward: 'relaciona-se com', outward: 'relaciona-se com' },
        inwardIssue: { key: 'ABC-3', fields: { summary: 'Terceiro' } }
      },
      { type: { name: 'Blocks' } }
    ])
    setup({ issueLinks })

    const data = ok(await invokeHandler('issues:links', { key: 'abc-1' }))

    expect(issueLinks).toHaveBeenCalledWith('ABC-1')
    expect(data.links).toEqual([
      {
        label: 'bloqueia',
        key: 'ABC-2',
        summary: 'Outro card',
        status: 'Pronto',
        statusCategory: 'done'
      },
      {
        label: 'relaciona-se com',
        key: 'ABC-3',
        summary: 'Terceiro',
        status: null,
        statusCategory: null
      }
    ])
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issues:links', { key: 'ABC-1' })).code).toBe('NOT_CONNECTED')
  })
})

describe('issues:changelog', () => {
  it('mapeia as entradas do changelog', async () => {
    const issueChangelog = vi.fn(async () => [
      {
        id: 'h1',
        author: { displayName: 'Alguém' },
        created: '2026-01-02T10:00:00.000Z',
        items: [
          { field: 'status', fromString: 'A fazer', toString: 'Em andamento' },
          { field: 'Rank', fromString: null, toString: 'higher' }
        ]
      }
    ])
    setup({ issueChangelog })

    const data = ok(await invokeHandler('issues:changelog', { key: 'abc-1' }))

    expect(issueChangelog).toHaveBeenCalledWith('ABC-1')
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0]).toMatchObject({ id: 'h1', authorName: 'Alguém' })
    // 'Rank' é ruído e não entra nos itens
    expect(data.entries[0].items).toEqual([
      { field: 'Status', from: 'A fazer', to: 'Em andamento' }
    ])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup({ issueChangelog: async () => [] })
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('issues:changelog', { key: 'ABC-1' })).code).toBe(
      'NOT_CONNECTED'
    )
  })
})

describe('sprint:active', () => {
  it('sem sprint ativa → null', async () => {
    setup()
    expect(ok(await invokeHandler('sprint:active', {})).sprint).toBeNull()
  })

  it('com sprint ativa → devolve a sprint', async () => {
    const t = setup()
    upsertSprints(t.db, 1, [
      {
        jiraId: 70,
        boardJiraId: 1,
        name: 'Sprint 70',
        state: 'active',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
        completeDate: null
      }
    ])

    expect(ok(await invokeHandler('sprint:active', {})).sprint).toMatchObject({
      jiraId: 70,
      name: 'Sprint 70'
    })
  })
})

describe('issues:activity', () => {
  it('lista as atividades do card, mais recente primeiro', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1')
    insertActivities(t.db, 1, [
      {
        issueKey: 'ABC-1',
        kind: 'comment',
        actorAccountId: 'me-1',
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'primeiro',
        occurredAt: '2026-01-01T10:00:00.000Z',
        sourceId: 's1'
      },
      {
        issueKey: 'ABC-1',
        kind: 'status_change',
        actorAccountId: 'me-1',
        actorName: 'Eu',
        field: 'status',
        fromValue: 'A fazer',
        toValue: 'Em andamento',
        bodyText: null,
        occurredAt: '2026-01-02T10:00:00.000Z',
        sourceId: 's2'
      }
    ])

    const data = ok(await invokeHandler('issues:activity', { key: 'abc-1' }))
    expect(data.activities.map((a) => a.kind)).toEqual(['status_change', 'comment'])
  })
})

describe('issues:search', () => {
  it('busca por trecho do título e respeita o limite', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1', { summary: 'Corrigir login', updated_at: '2026-01-03T00:00:00.000Z' })
    seedIssue(t.db, 'ABC-2', { summary: 'Corrigir logout', updated_at: '2026-01-02T00:00:00.000Z' })
    seedIssue(t.db, 'ABC-3', { summary: 'Outro assunto' })

    const todos = ok(await invokeHandler('issues:search', { query: 'corrigir' }))
    expect(todos.issues.map((i) => i.key)).toEqual(['ABC-1', 'ABC-2'])

    const limitado = ok(await invokeHandler('issues:search', { query: 'corrigir', limit: 1 }))
    expect(limitado.issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('busca curta → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issues:search', { query: 'a' })).code).toBe('INVALID_PAYLOAD')
  })
})

describe('sprint:list', () => {
  it('lista sprints com completeDate no lugar do fim', async () => {
    const t = setup()
    upsertSprints(t.db, 1, [
      {
        jiraId: 60,
        boardJiraId: 1,
        name: 'Sprint 60',
        state: 'closed',
        startDate: '2025-12-01',
        endDate: '2025-12-14',
        completeDate: '2025-12-16'
      },
      {
        jiraId: 70,
        boardJiraId: 1,
        name: 'Sprint 70',
        state: 'active',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
        completeDate: null
      }
    ])

    const data = ok(await invokeHandler('sprint:list', { limit: 5 }))
    expect(data.sprints.map((s) => [s.jiraId, s.endDate])).toEqual([
      [70, '2026-01-14'],
      [60, '2025-12-16']
    ])
  })

  it('sem limite usa o default', async () => {
    setup()
    expect(ok(await invokeHandler('sprint:list', {})).sprints).toEqual([])
  })
})

describe('stats:leadTime', () => {
  it('sem cards resolvidos → estatísticas vazias com a janela pedida', async () => {
    setup()
    expect(ok(await invokeHandler('stats:leadTime', { days: 30 }))).toEqual({
      statuses: [],
      cardCount: 0,
      windowDays: 30
    })
  })

  it('agrega os dias por status dos meus cards resolvidos', async () => {
    const t = setup()
    const created = nowIso(-4 * 86400_000)
    seedIssue(t.db, 'ABC-1', {
      assignee_account_id: 'me-1',
      created_at: created,
      resolved_at: nowIso(-86400_000),
      status_category: 'done'
    })
    insertActivities(t.db, 1, [
      {
        issueKey: 'ABC-1',
        kind: 'status_change',
        actorAccountId: 'me-1',
        actorName: 'Eu',
        field: 'status',
        fromValue: 'A fazer',
        toValue: 'Pronto',
        bodyText: null,
        occurredAt: nowIso(-2 * 86400_000),
        sourceId: 's1'
      }
    ])

    const data = ok(await invokeHandler('stats:leadTime', {}))

    expect(data.windowDays).toBe(90)
    expect(data.cardCount).toBe(1)
    expect(data.statuses.map((s) => s.status).sort()).toEqual(['A fazer', 'Pronto'])
  })
})

describe('activity:timeline', () => {
  it('filtra só as minhas atividades por padrão', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1')
    insertActivities(t.db, 1, [
      {
        issueKey: 'ABC-1',
        kind: 'comment',
        actorAccountId: 'me-1',
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'meu',
        occurredAt: nowIso(-3600_000),
        sourceId: 's1'
      },
      {
        issueKey: 'ABC-1',
        kind: 'comment',
        actorAccountId: 'outro',
        actorName: 'Outro',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'alheio',
        occurredAt: nowIso(-7200_000),
        sourceId: 's2'
      }
    ])

    const minhas = ok(await invokeHandler('activity:timeline', { period: { type: '7d' } }))
    expect(minhas.activities.map((a) => a.actorName)).toEqual(['Eu'])

    const todas = ok(
      await invokeHandler('activity:timeline', { period: { type: '7d' }, onlyMine: false })
    )
    expect(todas.activities).toHaveLength(2)
  })

  it('filtro por projeto', async () => {
    const t = setup()
    seedIssue(t.db, 'ABC-1')
    seedIssue(t.db, 'ZZZ-1', { project_key: 'ZZZ' })
    insertActivities(t.db, 1, [
      {
        issueKey: 'ZZZ-1',
        kind: 'comment',
        actorAccountId: 'me-1',
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'zzz',
        occurredAt: nowIso(-3600_000),
        sourceId: 's1'
      }
    ])

    expect(
      ok(await invokeHandler('activity:timeline', { period: { type: '7d' }, projectKey: 'ABC' }))
        .activities
    ).toEqual([])
    expect(
      ok(await invokeHandler('activity:timeline', { period: { type: '7d' }, projectKey: 'ZZZ' }))
        .activities
    ).toHaveLength(1)
  })
})

describe('resolveWithSprint', () => {
  it('período não-sprint não consulta a sprint ativa', () => {
    const t = setup()
    const range = resolveWithSprint(t.ctx, 1, { type: 'today' })
    expect(range.start < range.end).toBe(true)
  })
})
