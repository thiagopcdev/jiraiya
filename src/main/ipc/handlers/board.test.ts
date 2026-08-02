import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { clearBoardColumnCache, registerBoardHandlers } = await import('./board')
const { upsertBoards, upsertSprints } = await import('../../db/repos/catalog')
const { getPrefs, setPrefs } = await import('../../db/repos/misc')
const { JiraHttpError } = await import('../../jira/http')

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
  registerBoardHandlers(t.ctx)
  return t
}

/** ids de board únicos: o cache de colunas é module-level. */
let boardSeq = 0
function nextBoardId(): number {
  boardSeq += 1
  return 1000 + boardSeq
}

const statuses = [
  { id: '1', name: 'A fazer', categoryKey: 'new' as const },
  { id: '3', name: 'Em andamento', categoryKey: 'indeterminate' as const },
  { id: '5', name: 'Pronto', categoryKey: 'done' as const }
]

function jiraColumns(): Fake {
  return {
    boardConfiguration: async () => ({
      columns: [
        { name: 'A fazer', statusIds: ['1'] },
        { name: 'Em andamento', statusIds: ['3'] },
        { name: 'Pronto', statusIds: ['5'] }
      ]
    }),
    listStatuses: async () => statuses
  }
}

beforeEach(() => {
  resetElectronMock()
  clearBoardColumnCache()
})

describe('board:view', () => {
  it('sem boards sincronizados → NO_BOARDS', async () => {
    setup(jiraColumns())
    expect(err(await invokeHandler('board:view', {})).code).toBe('NO_BOARDS')
  })

  it('board scrum: agrupa os cards da sprint ativa nas colunas do Jira', async () => {
    const scrum = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [
      { jiraId: scrum, name: 'Scrum', type: 'scrum', projectKey: 'ABC' },
      { jiraId: nextBoardId(), name: 'Kanban', type: 'kanban', projectKey: 'ABC' }
    ])
    upsertSprints(t.db, 1, [
      {
        jiraId: 70,
        boardJiraId: scrum,
        name: 'Sprint 70',
        state: 'active',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
        completeDate: null
      }
    ])
    seedIssue(t.db, 'ABC-1', { sprint_jira_id: 70, status: 'Em andamento' })
    seedIssue(t.db, 'ABC-2', { sprint_jira_id: 70, status: 'Bloqueado' })

    const data = ok(await invokeHandler('board:view', {}))

    expect(data.board.type).toBe('scrum')
    expect(data.boards).toHaveLength(2)
    expect(data.sprint).toEqual({ jiraId: 70, name: 'Sprint 70' })
    expect(data.sprints).toHaveLength(1)
    expect(data.readOnly).toBe(false)
    expect(data.columnsSource).toBe('jira')
    expect(data.columns.map((c) => [c.name, c.issues.map((i) => i.key)])).toEqual([
      ['A fazer', []],
      ['Em andamento', ['ABC-1']],
      ['Pronto', []]
    ])
    expect(data.unmapped.map((i) => i.key)).toEqual(['ABC-2'])
  })

  it('coluna com limite de WIP no Jira chega em columns[].wipMax; as demais (sem constraint) ficam null', async () => {
    const boardId = nextBoardId()
    const t = setup({
      boardConfiguration: async () => ({
        columns: [
          { name: 'A fazer', statusIds: ['1'], wipMax: null },
          { name: 'Em andamento', statusIds: ['3'], wipMax: 2 },
          { name: 'Pronto', statusIds: ['5'], wipMax: null }
        ]
      }),
      listStatuses: async () => statuses
    })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'K', type: 'kanban', projectKey: 'ABC' }])

    const data = ok(await invokeHandler('board:view', { boardJiraId: boardId }))

    expect(data.columns.map((c) => [c.name, c.wipMax])).toEqual([
      ['A fazer', null],
      ['Em andamento', 2],
      ['Pronto', null]
    ])
  })

  it('segunda chamada usa o cache de colunas', async () => {
    const boardId = nextBoardId()
    const cols = jiraColumns()
    const boardConfiguration = vi.fn(cols.boardConfiguration as () => Promise<unknown>)
    const t = setup({ ...cols, boardConfiguration })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'B', type: 'kanban', projectKey: 'ABC' }])

    ok(await invokeHandler('board:view', {}))
    ok(await invokeHandler('board:view', {}))

    expect(boardConfiguration).toHaveBeenCalledTimes(1)
  })

  it('config do Jira indisponível → colunas de fallback por categoria', async () => {
    const boardId = nextBoardId()
    const t = setup({
      boardConfiguration: async () => {
        throw new Error('502')
      },
      listStatuses: async () => statuses
    })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'B', type: 'kanban', projectKey: 'ABC' }])
    seedIssue(t.db, 'ABC-1', { status: 'Em revisão', status_category: 'indeterminate' })
    seedIssue(t.db, 'ABC-2', { status: 'A fazer', status_category: null })

    const data = ok(await invokeHandler('board:view', {}))

    expect(data.columnsSource).toBe('fallback')
    expect(data.columns.map((c) => c.name)).toEqual(['A fazer', 'Em andamento', 'Concluído'])
    expect(data.columns[0].issues.map((i) => i.key)).toEqual(['ABC-2'])
    expect(data.columns[1].issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('config com zero colunas → fallback', async () => {
    const boardId = nextBoardId()
    const t = setup({
      boardConfiguration: async () => ({ columns: [] }),
      listStatuses: async () => statuses
    })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'B', type: 'kanban', projectKey: 'ABC' }])

    expect(ok(await invokeHandler('board:view', {})).columnsSource).toBe('fallback')
  })

  it('sem client → fallback', async () => {
    const boardId = nextBoardId()
    const t = setup(jiraColumns())
    t.setClient(null)
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'B', type: 'kanban', projectKey: 'ABC' }])

    expect(ok(await invokeHandler('board:view', {})).columnsSource).toBe('fallback')
  })

  it('boardJiraId inexistente → BOARD_NOT_FOUND', async () => {
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: nextBoardId(), name: 'B', type: 'kanban', projectKey: 'ABC' }])

    expect(err(await invokeHandler('board:view', { boardJiraId: 99999 })).code).toBe(
      'BOARD_NOT_FOUND'
    )
  })

  it('sprintJiraId inexistente → SPRINT_NOT_FOUND', async () => {
    const boardId = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'S', type: 'scrum', projectKey: 'ABC' }])

    expect(err(await invokeHandler('board:view', { sprintJiraId: 4242 })).code).toBe(
      'SPRINT_NOT_FOUND'
    )
  })

  it('sprint fechada escolhida → readOnly', async () => {
    const boardId = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'S', type: 'scrum', projectKey: 'ABC' }])
    upsertSprints(t.db, 1, [
      {
        jiraId: 60,
        boardJiraId: boardId,
        name: 'Sprint 60',
        state: 'closed',
        startDate: '2025-12-01',
        endDate: '2025-12-14',
        completeDate: '2025-12-15'
      },
      {
        jiraId: 70,
        boardJiraId: boardId,
        name: 'Sprint 70',
        state: 'active',
        startDate: '2026-01-01',
        endDate: '2026-01-14',
        completeDate: null
      }
    ])
    seedIssue(t.db, 'ABC-1', { sprint_jira_id: 60, status: 'Pronto' })

    const data = ok(await invokeHandler('board:view', { sprintJiraId: 60 }))

    expect(data.sprint).toEqual({ jiraId: 60, name: 'Sprint 60' })
    expect(data.readOnly).toBe(true)
    // ordem: mais recente primeiro; a fechada usa completeDate como fim
    expect(data.sprints.map((s) => s.jiraId)).toEqual([70, 60])
    expect(data.sprints[1].endDate).toBe('2025-12-15')
    expect(data.columns[2].issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('board scrum sem sprint ativa → sprint null e escopo vazio', async () => {
    const boardId = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'S', type: 'scrum', projectKey: 'ABC' }])
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('board:view', {}))

    expect(data.sprint).toBeNull()
    expect(data.readOnly).toBe(false)
    expect(data.columns.every((c) => c.issues.length === 0)).toBe(true)
  })

  it('board kanban: cards do projeto, sem seletor de sprint', async () => {
    const boardId = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'K', type: 'kanban', projectKey: 'ABC' }])
    seedIssue(t.db, 'ABC-1', { status: 'A fazer' })
    seedIssue(t.db, 'ZZZ-9', { status: 'A fazer', project_key: 'ZZZ' })

    const data = ok(await invokeHandler('board:view', { boardJiraId: boardId }))

    expect(data.sprint).toBeNull()
    expect(data.sprints).toEqual([])
    expect(data.columns[0].issues.map((i) => i.key)).toEqual(['ABC-1'])
  })

  it('kanban com 1ª coluna de backlog marca isBacklog (as demais não)', async () => {
    const boardId = nextBoardId()
    const t = setup({
      boardConfiguration: async () => ({
        columns: [
          { name: 'Lista de pendências', statusIds: ['1'] },
          { name: 'Em andamento', statusIds: ['3'] },
          { name: 'Pronto', statusIds: ['5'] }
        ]
      }),
      listStatuses: async () => statuses
    })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'K', type: 'kanban', projectKey: 'ABC' }])

    const data = ok(await invokeHandler('board:view', { boardJiraId: boardId }))

    expect(data.columns.map((c) => [c.name, c.isBacklog])).toEqual([
      ['Lista de pendências', true],
      ['Em andamento', false],
      ['Pronto', false]
    ])
  })

  it('scrum nunca marca coluna como backlog', async () => {
    const boardId = nextBoardId()
    const t = setup({
      boardConfiguration: async () => ({
        columns: [
          { name: 'Backlog', statusIds: ['1'] },
          { name: 'Pronto', statusIds: ['5'] }
        ]
      }),
      listStatuses: async () => statuses
    })
    upsertBoards(t.db, 1, [{ jiraId: boardId, name: 'S', type: 'scrum', projectKey: 'ABC' }])

    const data = ok(await invokeHandler('board:view', { boardJiraId: boardId }))

    expect(data.columns.every((c) => c.isBacklog === false)).toBe(true)
  })

  it('lembra o último board escolhido e o abre por padrão no próximo acesso', async () => {
    const scrum = nextBoardId()
    const kanban = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [
      { jiraId: scrum, name: 'Scrum', type: 'scrum', projectKey: 'ABC' },
      { jiraId: kanban, name: 'Kanban', type: 'kanban', projectKey: 'ABC' }
    ])

    // primeiro acesso sem preferência: default scrum
    expect(ok(await invokeHandler('board:view', {})).board.jiraId).toBe(scrum)
    // usuário troca para o kanban…
    expect(ok(await invokeHandler('board:view', { boardJiraId: kanban })).board.jiraId).toBe(kanban)
    // …e o próximo acesso sem board pedido já abre nele
    expect(ok(await invokeHandler('board:view', {})).board.jiraId).toBe(kanban)
  })

  it('último board sumiu do Jira → cai no default sem erro', async () => {
    const scrum = nextBoardId()
    const t = setup(jiraColumns())
    upsertBoards(t.db, 1, [{ jiraId: scrum, name: 'Scrum', type: 'scrum', projectKey: 'ABC' }])
    setPrefs(t.db, { lastBoardJiraId: 999999 })

    const data = ok(await invokeHandler('board:view', {}))

    expect(data.board.jiraId).toBe(scrum)
    // e a preferência é corrigida para o board resolvido
    expect(getPrefs(t.db).lastBoardJiraId).toBe(scrum)
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup(jiraColumns())
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('board:view', {})).code).toBe('NOT_CONNECTED')
  })

  it('boardJiraId não inteiro → INVALID_PAYLOAD', async () => {
    setup(jiraColumns())
    expect(err(await invokeHandler('board:view', { boardJiraId: 1.5 })).code).toBe(
      'INVALID_PAYLOAD'
    )
  })
})

describe('board:move', () => {
  const transitions = [
    {
      id: '11',
      name: 'Iniciar',
      toStatusId: '3',
      toStatusName: 'Em andamento',
      toCategoryKey: 'indeterminate'
    },
    { id: '12', name: 'Concluir', toStatusId: '5', toStatusName: 'Pronto', toCategoryKey: 'done' }
  ]

  it('move o card e atualiza o status local', async () => {
    const doTransition = vi.fn(async () => {})
    const t = setup({ issueTransitions: async () => transitions, doTransition })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('board:move', {
        issueKey: 'abc-1',
        targetStatusIds: ['9', '5'],
        targetColumnName: 'Pronto'
      })
    )

    expect(data).toEqual({ newStatus: 'Pronto', newStatusCategory: 'done' })
    expect(doTransition).toHaveBeenCalledWith('ABC-1', '12')
    expect(t.db.prepare('SELECT status FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      status: 'Pronto'
    })
  })

  it('card fora do cache → ISSUE_NOT_FOUND', async () => {
    setup({ issueTransitions: async () => transitions })

    expect(
      err(
        await invokeHandler('board:move', {
          issueKey: 'ABC-9',
          targetStatusIds: ['5'],
          targetColumnName: 'Pronto'
        })
      ).code
    ).toBe('ISSUE_NOT_FOUND')
  })

  it('nenhuma transição casa → NO_TRANSITION', async () => {
    const t = setup({ issueTransitions: async () => transitions })
    seedIssue(t.db, 'ABC-1')

    const e = err(
      await invokeHandler('board:move', {
        issueKey: 'ABC-1',
        targetStatusIds: ['77'],
        targetColumnName: 'Bloqueado'
      })
    )
    expect(e.code).toBe('NO_TRANSITION')
    expect(e.message).toContain('ABC-1')
    expect(e.message).toContain('Bloqueado')
  })

  it('Jira recusa → TRANSITION_FAILED', async () => {
    const t = setup({
      issueTransitions: async () => transitions,
      doTransition: async () => {
        throw new JiraHttpError(400, 'Bad', JSON.stringify({ errorMessages: ['workflow'] }))
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(
      await invokeHandler('board:move', {
        issueKey: 'ABC-1',
        targetStatusIds: ['5'],
        targetColumnName: 'Pronto'
      })
    )
    expect(e.code).toBe('TRANSITION_FAILED')
    expect(e.message).toContain('workflow')
  })

  it('erro genérico sobe', async () => {
    const t = setup({
      issueTransitions: async () => transitions,
      doTransition: async () => {
        throw new Error('rede')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(
        await invokeHandler('board:move', {
          issueKey: 'ABC-1',
          targetStatusIds: ['5'],
          targetColumnName: 'Pronto'
        })
      ).code
    ).toBe('INTERNAL')
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    seedIssue(t.db, 'ABC-1')

    expect(
      err(
        await invokeHandler('board:move', {
          issueKey: 'ABC-1',
          targetStatusIds: ['5'],
          targetColumnName: 'Pronto'
        })
      ).code
    ).toBe('NOT_CONNECTED')
  })

  it('lista de status vazia → INVALID_PAYLOAD', async () => {
    setup()
    expect(
      err(
        await invokeHandler('board:move', {
          issueKey: 'ABC-1',
          targetStatusIds: [],
          targetColumnName: 'Pronto'
        })
      ).code
    ).toBe('INVALID_PAYLOAD')
  })
})
