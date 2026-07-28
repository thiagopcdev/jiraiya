import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const ai = vi.hoisted(() => ({
  provider: null as { id: string; label: string } | null,
  run: vi.fn<(feature: string, prompt: string) => Promise<string>>(async () => '')
}))

vi.mock('../../ai/service', () => ({
  activeProvider: () => ai.provider,
  runAiPrompt: (feature: string, prompt: string) => ai.run(feature, prompt)
}))

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerAskHandlers } = await import('./ask')
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

function http400(body: unknown): Error {
  return new JiraHttpError(400, 'Bad Request', JSON.stringify(body))
}

function setup(methods: Fake = {}): Ctx {
  const t = makeTestContext({ client: client(methods) })
  registerAskHandlers(t.ctx)
  return t
}

function setSpField(t: Ctx, value: string | null): void {
  t.db.prepare('UPDATE workspace SET story_points_field_id = ? WHERE id = 1').run(value)
}

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

beforeEach(() => {
  resetElectronMock()
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run.mockReset()
})

describe('ask:question', () => {
  it('responde texto puro sem ações', async () => {
    ai.run.mockResolvedValue('  A sprint está no prazo.  ')
    setup()

    const data = ok(await invokeHandler('ask:question', { question: 'como vai a sprint?' }))

    expect(data).toEqual({
      answer: 'A sprint está no prazo.',
      generatedBy: 'claude',
      actions: []
    })
    expect(ai.run).toHaveBeenCalledWith('ask', expect.stringContaining('como vai a sprint?'))
  })

  it('separa o bloco de ações propostas', async () => {
    ai.run.mockResolvedValue(
      'Vou mover.\n===ACOES===\n[{"type":"move_status","key":"ABC-1","statusName":"Pronto"}]'
    )
    const t = setup()
    seedIssue(t.db, 'ABC-1', { assignee_account_id: 'me-1' })

    const data = ok(
      await invokeHandler('ask:question', {
        question: 'move o ABC-1',
        history: [{ role: 'user', content: 'oi' }]
      })
    )

    expect(data.answer).toBe('Vou mover.')
    expect(data.actions).toHaveLength(1)
    expect(data.actions[0]).toMatchObject({ type: 'move_status', key: 'ABC-1' })
  })

  it('sem provider → AI_UNAVAILABLE', async () => {
    ai.provider = null
    setup()

    const e = err(await invokeHandler('ask:question', { question: 'oi' }))
    expect(e.code).toBe('AI_UNAVAILABLE')
    expect(e.message).toContain('Nenhum provider')
  })

  it('IA falha → AI_UNAVAILABLE com a mensagem do erro', async () => {
    ai.run.mockRejectedValue(new Error('timeout do CLI'))
    setup()

    expect(err(await invokeHandler('ask:question', { question: 'oi' }))).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'timeout do CLI'
    })
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup()
    t.db.prepare('DELETE FROM workspace').run()

    expect(err(await invokeHandler('ask:question', { question: 'oi' })).code).toBe('NOT_CONNECTED')
  })

  it('pergunta vazia → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('ask:question', { question: '  ' })).code).toBe(
      'INVALID_PAYLOAD'
    )
  })
})

describe('ask:execute — move_status', () => {
  it('acha a transição por nome de status e atualiza o cache', async () => {
    const doTransition = vi.fn(async () => {})
    const t = setup({ issueTransitions: async () => transitions, doTransition })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('ask:execute', {
        action: { type: 'move_status', key: 'abc-1', statusName: 'pronto' }
      })
    )

    expect(data).toEqual({ ok: true, message: 'ABC-1 movido para Pronto' })
    expect(doTransition).toHaveBeenCalledWith('ABC-1', '12')
    expect(t.db.prepare('SELECT status FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      status: 'Pronto'
    })
  })

  it('acha a transição pelo nome da transição', async () => {
    const doTransition = vi.fn(async () => {})
    const t = setup({ issueTransitions: async () => transitions, doTransition })
    seedIssue(t.db, 'ABC-1')

    ok(
      await invokeHandler('ask:execute', {
        action: { type: 'move_status', key: 'ABC-1', statusName: 'Iniciar' }
      })
    )
    expect(doTransition).toHaveBeenCalledWith('ABC-1', '11')
  })

  it('sem statusName → VALIDATION', async () => {
    setup({ issueTransitions: async () => transitions })

    expect(
      err(await invokeHandler('ask:execute', { action: { type: 'move_status', key: 'ABC-1' } }))
        .code
    ).toBe('VALIDATION')
  })

  it('destino inexistente → NO_TRANSITION listando as opções', async () => {
    setup({ issueTransitions: async () => transitions })

    const e = err(
      await invokeHandler('ask:execute', {
        action: { type: 'move_status', key: 'ABC-1', statusName: 'Bloqueado' }
      })
    )
    expect(e.code).toBe('NO_TRANSITION')
    expect(e.message).toContain('Em andamento, Pronto')
  })

  it('sem transições disponíveis → NO_TRANSITION sem lista', async () => {
    setup({ issueTransitions: async () => [] })

    const e = err(
      await invokeHandler('ask:execute', {
        action: { type: 'move_status', key: 'ABC-1', statusName: 'Bloqueado' }
      })
    )
    expect(e.message).toContain('não tem transições disponíveis')
  })

  it('Jira recusa → TRANSITION_FAILED', async () => {
    setup({
      issueTransitions: async () => transitions,
      doTransition: async () => {
        throw http400({ errorMessages: ['fluxo travado'] })
      }
    })

    const e = err(
      await invokeHandler('ask:execute', {
        action: { type: 'move_status', key: 'ABC-1', statusName: 'Pronto' }
      })
    )
    expect(e.code).toBe('TRANSITION_FAILED')
    expect(e.message).toContain('fluxo travado')
  })

  it('erro genérico sobe', async () => {
    setup({
      issueTransitions: async () => transitions,
      doTransition: async () => {
        throw new Error('rede')
      }
    })

    expect(
      err(
        await invokeHandler('ask:execute', {
          action: { type: 'move_status', key: 'ABC-1', statusName: 'Pronto' }
        })
      ).code
    ).toBe('INTERNAL')
  })
})

describe('ask:execute — assign_me', () => {
  it('atribui ao usuário conectado', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('ask:execute', { action: { type: 'assign_me', key: 'ABC-1' } })
    )

    expect(data.message).toBe('ABC-1 atribuído a você')
    expect(updateIssue).toHaveBeenCalledWith('ABC-1', { assignee: { id: 'me-1' } })
    expect(
      t.db
        .prepare('SELECT assignee_account_id a, assignee_name n FROM issue WHERE key = ?')
        .get('ABC-1')
    ).toEqual({ a: 'me-1', n: 'Eu Mesmo' })
  })

  it('Jira recusa → UPDATE_FAILED', async () => {
    setup({
      updateIssue: async () => {
        throw http400({ errors: { assignee: 'inválido' } })
      }
    })

    expect(
      err(await invokeHandler('ask:execute', { action: { type: 'assign_me', key: 'ABC-1' } })).code
    ).toBe('UPDATE_FAILED')
  })
})

describe('ask:execute — comment', () => {
  it('publica o comentário', async () => {
    const addComment = vi.fn(async () => {})
    setup({ addComment })

    const data = ok(
      await invokeHandler('ask:execute', {
        action: { type: 'comment', key: 'abc-1', text: 'atualização' }
      })
    )

    expect(data.message).toBe('Comentário publicado em ABC-1')
    expect(addComment).toHaveBeenCalledWith('ABC-1', expect.objectContaining({ type: 'doc' }))
  })

  it('sem texto → VALIDATION', async () => {
    setup({ addComment: async () => {} })
    expect(
      err(await invokeHandler('ask:execute', { action: { type: 'comment', key: 'ABC-1' } })).code
    ).toBe('VALIDATION')
  })

  it('Jira recusa → COMMENT_FAILED', async () => {
    setup({
      addComment: async () => {
        throw http400({})
      }
    })

    expect(
      err(
        await invokeHandler('ask:execute', { action: { type: 'comment', key: 'ABC-1', text: 'x' } })
      ).code
    ).toBe('COMMENT_FAILED')
  })
})

describe('ask:execute — log_work', () => {
  it('registra o tempo', async () => {
    const addWorklog = vi.fn(async () => {})
    setup({ addWorklog })

    const data = ok(
      await invokeHandler('ask:execute', {
        action: { type: 'log_work', key: 'ABC-1', timeSpent: '1h 30m' }
      })
    )

    expect(data.message).toBe('1h 30m registrado em ABC-1')
    expect(addWorklog).toHaveBeenCalledWith('ABC-1', '1h 30m')
  })

  it('sem duração → VALIDATION', async () => {
    setup({ addWorklog: async () => {} })
    expect(
      err(await invokeHandler('ask:execute', { action: { type: 'log_work', key: 'ABC-1' } })).code
    ).toBe('VALIDATION')
  })

  it('Jira recusa → WORKLOG_FAILED', async () => {
    setup({
      addWorklog: async () => {
        throw http400({})
      }
    })

    expect(
      err(
        await invokeHandler('ask:execute', {
          action: { type: 'log_work', key: 'ABC-1', timeSpent: '1h' }
        })
      ).code
    ).toBe('WORKLOG_FAILED')
  })
})

describe('ask:execute — set_story_points', () => {
  it('grava no campo configurado e no cache', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    setSpField(t, 'customfield_10016')
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('ask:execute', {
        action: { type: 'set_story_points', key: 'ABC-1', storyPoints: 5 }
      })
    )

    expect(data.message).toBe('ABC-1 com 5 story points')
    expect(updateIssue).toHaveBeenCalledWith('ABC-1', { customfield_10016: 5 })
    expect(t.db.prepare('SELECT story_points s FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      s: 5
    })
  })

  it('sem valor → VALIDATION', async () => {
    const t = setup({ updateIssue: async () => {} })
    setSpField(t, 'customfield_10016')

    expect(
      err(
        await invokeHandler('ask:execute', { action: { type: 'set_story_points', key: 'ABC-1' } })
      ).code
    ).toBe('VALIDATION')
  })

  it('campo não configurado → NO_STORY_POINTS_FIELD', async () => {
    const t = setup({ updateIssue: async () => {} })
    setSpField(t, 'none')

    expect(
      err(
        await invokeHandler('ask:execute', {
          action: { type: 'set_story_points', key: 'ABC-1', storyPoints: 3 }
        })
      ).code
    ).toBe('NO_STORY_POINTS_FIELD')
  })

  it('Jira recusa → UPDATE_FAILED', async () => {
    const t = setup({
      updateIssue: async () => {
        throw http400({})
      }
    })
    setSpField(t, 'customfield_10016')

    expect(
      err(
        await invokeHandler('ask:execute', {
          action: { type: 'set_story_points', key: 'ABC-1', storyPoints: 3 }
        })
      ).code
    ).toBe('UPDATE_FAILED')
  })
})

describe('ask:execute — pré-condições', () => {
  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)

    expect(
      err(await invokeHandler('ask:execute', { action: { type: 'assign_me', key: 'ABC-1' } })).code
    ).toBe('NOT_CONNECTED')
  })

  it('tipo de ação fora do enum → INVALID_PAYLOAD', async () => {
    setup()
    const bad = { action: { type: 'apagar', key: 'ABC-1' } } as unknown as Parameters<
      typeof invokeHandler<'ask:execute'>
    >[1]

    expect(err(await invokeHandler('ask:execute', bad)).code).toBe('INVALID_PAYLOAD')
  })
})

describe('briefing:today', () => {
  it('sem briefing gravado → summaryId null', async () => {
    setup()
    expect(ok(await invokeHandler('briefing:today', {}))).toEqual({ summaryId: null })
  })

  it('briefing de hoje → devolve o id', async () => {
    const t = setup()
    const today = new Date().toLocaleDateString('sv')
    t.db
      .prepare('INSERT INTO user_pref (key, value_json) VALUES (?, ?), (?, ?)')
      .run('lastBriefingDate', today, 'lastBriefingSummaryId', '42')

    expect(ok(await invokeHandler('briefing:today', {}))).toEqual({ summaryId: 42 })
  })

  it('briefing de outro dia → summaryId null', async () => {
    const t = setup()
    t.db
      .prepare('INSERT INTO user_pref (key, value_json) VALUES (?, ?), (?, ?)')
      .run('lastBriefingDate', '1999-01-01', 'lastBriefingSummaryId', '7')

    expect(ok(await invokeHandler('briefing:today', {}))).toEqual({ summaryId: null })
  })
})
