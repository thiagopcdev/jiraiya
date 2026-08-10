import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerSprintMoveHandlers } = await import('./sprintMove')
const { upsertBoards } = await import('../../db/repos/catalog')
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
  registerSprintMoveHandlers(t.ctx)
  return t
}

function seedSprint(
  t: Ctx,
  s: { jiraId: number; name: string | null; state: string; startDate: string | null }
): void {
  t.db
    .prepare(
      `INSERT INTO sprint (workspace_id, jira_id, board_jira_id, name, state, start_date)
       VALUES (1, ?, 1, ?, ?, ?)`
    )
    .run(s.jiraId, s.name, s.state, s.startDate)
}

beforeEach(() => {
  resetElectronMock()
})

describe('sprint:moveTargets', () => {
  it('só ativas e futuras, ativa primeiro e futuras por data (null no fim)', async () => {
    const t = setup()
    t.setClient(null)
    seedSprint(t, { jiraId: 72, name: 'S72', state: 'future', startDate: null })
    seedSprint(t, { jiraId: 71, name: 'S71', state: 'future', startDate: '2026-02-01' })
    seedSprint(t, { jiraId: 70, name: 'S70', state: 'active', startDate: '2026-01-01' })
    seedSprint(t, { jiraId: 60, name: 'S60', state: 'closed', startDate: '2025-12-01' })

    const data = ok(await invokeHandler('sprint:moveTargets', {}))

    expect(data.sprints).toEqual([
      { jiraId: 70, name: 'S70', state: 'active' },
      { jiraId: 71, name: 'S71', state: 'future' },
      { jiraId: 72, name: 'S72', state: 'future' }
    ])
  })

  it('futura sem data vai para o fim mesmo inserida antes das datadas', async () => {
    const t = setup()
    t.setClient(null)
    seedSprint(t, { jiraId: 91, name: 'sem data', state: 'future', startDate: null })
    seedSprint(t, { jiraId: 92, name: 'com data', state: 'future', startDate: '2026-05-01' })
    seedSprint(t, { jiraId: 93, name: 'outra sem data', state: 'future', startDate: null })
    seedSprint(t, { jiraId: 94, name: 'mais cedo', state: 'future', startDate: '2026-04-01' })

    const data = ok(await invokeHandler('sprint:moveTargets', {}))
    expect(data.sprints.map((s) => s.jiraId)).toEqual([94, 92, 91, 93])
  })

  it('futuras com a mesma data mantêm a ordem', async () => {
    const t = setup()
    t.setClient(null)
    seedSprint(t, { jiraId: 81, name: 'A', state: 'future', startDate: '2026-03-01' })
    seedSprint(t, { jiraId: 82, name: 'B', state: 'future', startDate: '2026-03-01' })

    const data = ok(await invokeHandler('sprint:moveTargets', {}))
    expect(data.sprints.map((s) => s.jiraId)).toEqual([81, 82])
  })

  it('refresh ao vivo sobrescreve o DB e adiciona sprints novas', async () => {
    const listSprints = vi.fn(async () => [
      { id: 70, name: 'S70 renomeada', state: 'active', startDate: '2026-01-01' },
      { id: 73, name: 'S73', state: 'future', startDate: '2026-04-01' },
      { id: 60, name: 'S60', state: 'closed', startDate: '2025-12-01' }
    ])
    const t = setup({ listSprints })
    upsertBoards(t.db, 1, [{ jiraId: 1, name: 'B', type: 'scrum', projectKey: 'ABC' }])
    seedSprint(t, { jiraId: 70, name: 'S70', state: 'active', startDate: '2026-01-01' })

    const data = ok(await invokeHandler('sprint:moveTargets', {}))

    expect(listSprints).toHaveBeenCalledWith(1)
    expect(data.sprints).toEqual([
      { jiraId: 70, name: 'S70 renomeada', state: 'active' },
      { jiraId: 73, name: 'S73', state: 'future' }
    ])
  })

  it('board sem sprints (erro no Jira) cai só no DB', async () => {
    const t = setup({
      listSprints: async () => {
        throw new Error('404')
      }
    })
    upsertBoards(t.db, 1, [{ jiraId: 1, name: 'B', type: 'scrum', projectKey: 'ABC' }])
    seedSprint(t, { jiraId: 70, name: 'S70', state: 'active', startDate: '2026-01-01' })

    const data = ok(await invokeHandler('sprint:moveTargets', {}))
    expect(data.sprints).toEqual([{ jiraId: 70, name: 'S70', state: 'active' }])
  })

  it('sprint ao vivo sem nome/data vira null', async () => {
    const t = setup({ listSprints: async () => [{ id: 90, state: 'future' }] })
    upsertBoards(t.db, 1, [{ jiraId: 1, name: 'B', type: 'scrum', projectKey: 'ABC' }])

    const data = ok(await invokeHandler('sprint:moveTargets', {}))
    expect(data.sprints).toEqual([{ jiraId: 90, name: null, state: 'future' }])
  })

  it('sem nada sincronizado → lista vazia', async () => {
    const t = setup()
    t.setClient(null)
    expect(ok(await invokeHandler('sprint:moveTargets', {})).sprints).toEqual([])
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup()
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('sprint:moveTargets', {})).code).toBe('NOT_CONNECTED')
  })
})

describe('sprint:moveIssue', () => {
  it('move para uma sprint e grava o id local', async () => {
    const moveIssuesToSprint = vi.fn(async () => {})
    const t = setup({ moveIssuesToSprint })
    seedIssue(t.db, 'ABC-1', { sprint_jira_id: 60 })

    const data = ok(await invokeHandler('sprint:moveIssue', { key: 'abc-1', target: 70 }))

    expect(data).toEqual({ ok: true })
    expect(moveIssuesToSprint).toHaveBeenCalledWith(70, ['ABC-1'])
    expect(t.db.prepare('SELECT sprint_jira_id s FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      s: 70
    })
  })

  it('move para o backlog e limpa o id local', async () => {
    const moveIssuesToBacklog = vi.fn(async () => {})
    const t = setup({ moveIssuesToBacklog })
    seedIssue(t.db, 'ABC-1', { sprint_jira_id: 70 })

    const data = ok(await invokeHandler('sprint:moveIssue', { key: 'ABC-1', target: 'backlog' }))

    expect(data).toEqual({ ok: true })
    expect(moveIssuesToBacklog).toHaveBeenCalledWith(['ABC-1'])
    expect(t.db.prepare('SELECT sprint_jira_id s FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      s: null
    })
  })

  it('Jira recusa → MOVE_FAILED com a mensagem parseada', async () => {
    const t = setup({
      moveIssuesToSprint: async () => {
        throw new JiraHttpError(400, 'Bad', JSON.stringify({ errorMessages: ['sprint fechada'] }))
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('sprint:moveIssue', { key: 'ABC-1', target: 70 }))
    expect(e.code).toBe('MOVE_FAILED')
    expect(e.message).toContain('sprint fechada')
  })

  // BT-907: mover card já excluído no Jira devolvia só "404" e o card ficava
  it('card excluído no Jira → ISSUE_GONE e sai do cache local', async () => {
    const t = setup({
      moveIssuesToSprint: async () => {
        throw new JiraHttpError(404, 'Jira respondeu 404')
      },
      issueExists: async () => false
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('sprint:moveIssue', { key: 'ABC-1', target: 70 }))
    expect(e.code).toBe('ISSUE_GONE')
    expect(e.message).toContain('ABC-1')
    expect(t.db.prepare('SELECT key FROM issue WHERE key = ?').get('ABC-1')).toBeUndefined()
  })

  it('erro genérico sobe como INTERNAL', async () => {
    const t = setup({
      moveIssuesToBacklog: async () => {
        throw new Error('rede caiu')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(await invokeHandler('sprint:moveIssue', { key: 'ABC-1', target: 'backlog' })).toEqual({
      ok: false,
      code: 'INTERNAL',
      message: 'rede caiu'
    })
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('sprint:moveIssue', { key: 'ABC-1', target: 70 })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('target inválido → INVALID_PAYLOAD', async () => {
    setup()
    const bad = { key: 'ABC-1', target: 'sprint-nova' } as unknown as Parameters<
      typeof invokeHandler<'sprint:moveIssue'>
    >[1]
    expect(err(await invokeHandler('sprint:moveIssue', bad)).code).toBe('INVALID_PAYLOAD')
  })
})
