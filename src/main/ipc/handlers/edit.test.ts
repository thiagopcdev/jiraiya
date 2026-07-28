import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel, IpcResponse, IpcResult } from '@shared/ipc-contract'
import type { JiraClient } from '../../jira/client'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler, resetElectronMock } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerEditHandlers } = await import('./edit')
const { JiraHttpError } = await import('../../jira/http')

type Ctx = ReturnType<typeof makeTestContext>
type Fake = Record<string, unknown>

/** Fakes só implementam os métodos que o handler usa; o resto não é chamado. */
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

function netError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
    code: 'ECONNREFUSED'
  })
}

function http400(body: unknown): Error {
  return new JiraHttpError(400, 'Bad Request', JSON.stringify(body))
}

function setup(methods: Fake = {}): Ctx {
  const t = makeTestContext({ client: client(methods) })
  registerEditHandlers(t.ctx)
  return t
}

function pendingActions(t: Ctx): Array<{ type: string; issue_key: string; payload: string }> {
  return t.db.prepare('SELECT type, issue_key, payload FROM pending_action').all() as Array<{
    type: string
    issue_key: string
    payload: string
  }>
}

function issueRow(t: Ctx, key: string): Record<string, unknown> {
  return t.db.prepare('SELECT * FROM issue WHERE key = ?').get(key) as Record<string, unknown>
}

function setSpField(t: Ctx, value: string | null): void {
  t.db.prepare('UPDATE workspace SET story_points_field_id = ? WHERE id = 1').run(value)
}

beforeEach(() => {
  resetElectronMock()
})

describe('issues:editMeta', () => {
  it('mapeia editmeta + tempo do Jira', async () => {
    const t = setup({
      issueEditMeta: async () => ({
        fields: {
          customfield_10016: { name: 'Story Points' },
          priority: {
            name: 'Priority',
            allowedValues: [
              { id: '1', name: 'Alta' },
              { id: '2', name: 'Baixa' }
            ]
          },
          timetracking: { name: 'Controle de tempo' }
        }
      }),
      issueTimeTracking: async () => ({ timeSpent: '3h', originalEstimate: '1d' })
    })
    setSpField(t, 'customfield_10016')
    seedIssue(t.db, 'ABC-1', { priority: 'Alta' })

    const data = ok(await invokeHandler('issues:editMeta', { key: 'abc-1' }))

    expect(data.storyPointsEditable).toBe(true)
    expect(data.priority).toEqual({
      editable: true,
      current: 'Alta',
      options: [
        { id: '1', name: 'Alta' },
        { id: '2', name: 'Baixa' }
      ]
    })
    expect(data.timeSpent).toBe('3h')
    expect(data.originalEstimate).toBe('1d')
    expect(data.timeTrackingEditable).toBe(true)
  })

  it('story points desativado no workspace → não editável', async () => {
    const t = setup({
      issueEditMeta: async () => ({ fields: { customfield_10016: { name: 'Story Points' } } }),
      issueTimeTracking: async () => ({ timeSpent: null, originalEstimate: null })
    })
    setSpField(t, 'none')
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:editMeta', { key: 'ABC-1' }))
    expect(data.storyPointsEditable).toBe(false)
  })

  it('card fora do cache local → NOT_FOUND', async () => {
    setup({ issueEditMeta: async () => ({ fields: {} }) })
    expect(err(await invokeHandler('issues:editMeta', { key: 'ABC-9' })).code).toBe('NOT_FOUND')
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    seedIssue(t.db, 'ABC-1')

    expect(err(await invokeHandler('issues:editMeta', { key: 'ABC-1' })).code).toBe('NOT_CONNECTED')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup()
    t.db.prepare('DELETE FROM workspace').run()

    expect(err(await invokeHandler('issues:editMeta', { key: 'ABC-1' })).code).toBe('NOT_CONNECTED')
  })

  it('payload inválido → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issues:editMeta', { key: '' })).code).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:update', () => {
  it('envia campos ao Jira e aplica no cache local', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    setSpField(t, 'customfield_10016')
    seedIssue(t.db, 'ABC-1', { story_points: 1, priority: 'Baixa' })

    const data = ok(
      await invokeHandler('issues:update', {
        key: 'abc-1',
        storyPoints: 5,
        priorityId: '1',
        priorityName: 'Alta',
        assigneeAccountId: 'u-2',
        assigneeName: 'Outra Pessoa'
      })
    )

    expect(data).toEqual({ ok: true, queued: false })
    expect(updateIssue).toHaveBeenCalledWith('ABC-1', {
      customfield_10016: 5,
      priority: { id: '1' },
      assignee: { id: 'u-2' }
    })
    const row = issueRow(t, 'ABC-1')
    expect(row.story_points).toBe(5)
    expect(row.priority).toBe('Alta')
    expect(row.assignee_account_id).toBe('u-2')
    expect(row.assignee_name).toBe('Outra Pessoa')
  })

  it('estimativa original e severidade viram campos do Jira', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    seedIssue(t.db, 'ABC-1')

    ok(
      await invokeHandler('issues:update', {
        key: 'ABC-1',
        originalEstimate: '1d 4h',
        severity: { fieldId: 'customfield_20', optionId: '7' }
      })
    )

    expect(updateIssue).toHaveBeenCalledWith('ABC-1', {
      customfield_20: { id: '7' },
      timetracking: { originalEstimate: '1d 4h' }
    })
  })

  it('remover responsável manda assignee null', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    seedIssue(t.db, 'ABC-1', { assignee_account_id: 'u-1', assignee_name: 'Eu' })

    ok(
      await invokeHandler('issues:update', {
        key: 'ABC-1',
        assigneeAccountId: null,
        assigneeName: null
      })
    )

    expect(updateIssue).toHaveBeenCalledWith('ABC-1', { assignee: null })
    expect(issueRow(t, 'ABC-1').assignee_account_id).toBeNull()
  })

  it('nada informado → NOTHING_TO_UPDATE', async () => {
    const t = setup({ updateIssue: async () => {} })
    seedIssue(t.db, 'ABC-1')

    expect(err(await invokeHandler('issues:update', { key: 'ABC-1' })).code).toBe(
      'NOTHING_TO_UPDATE'
    )
  })

  it('story points sem campo configurado → NOTHING_TO_UPDATE', async () => {
    const t = setup({ updateIssue: async () => {} })
    setSpField(t, 'none')
    seedIssue(t.db, 'ABC-1')

    expect(err(await invokeHandler('issues:update', { key: 'ABC-1', storyPoints: 3 })).code).toBe(
      'NOTHING_TO_UPDATE'
    )
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ updateIssue: async () => {} })
    expect(err(await invokeHandler('issues:update', { key: 'ABC-9', priorityId: '1' })).code).toBe(
      'NOT_FOUND'
    )
  })

  it('Jira recusa (400) → UPDATE_FAILED com a mensagem do Jira', async () => {
    const t = setup({
      updateIssue: async () => {
        throw http400({ errors: { priority: 'campo inválido' } })
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:update', { key: 'ABC-1', priorityId: '1' }))
    expect(e.code).toBe('UPDATE_FAILED')
    expect(e.message).toContain('priority: campo inválido')
  })

  it('erro genérico sobe como INTERNAL', async () => {
    const t = setup({
      updateIssue: async () => {
        throw new Error('boom')
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:update', { key: 'ABC-1', priorityId: '1' }))
    expect(e).toEqual({ code: 'INTERNAL', message: 'boom' })
  })

  it('sem rede → enfileira com revert, aplica local e avisa a fila', async () => {
    const t = setup({
      updateIssue: async () => {
        throw netError()
      }
    })
    setSpField(t, 'customfield_10016')
    seedIssue(t.db, 'ABC-1', {
      story_points: 2,
      priority: 'Baixa',
      assignee_account_id: 'u-0',
      assignee_name: 'Antigo'
    })

    const data = ok(
      await invokeHandler('issues:update', {
        key: 'ABC-1',
        storyPoints: 8,
        priorityId: '1',
        priorityName: 'Alta',
        assigneeAccountId: 'u-2',
        assigneeName: 'Novo'
      })
    )

    expect(data).toEqual({ ok: true, queued: true })
    const [action] = pendingActions(t)
    expect(action.type).toBe('update')
    expect(action.issue_key).toBe('ABC-1')
    const payload = JSON.parse(action.payload) as {
      summary: string
      fields: Record<string, unknown>
      revert: Record<string, unknown>
    }
    expect(payload.summary).toBe('Editar campos')
    expect(payload.fields.storyPoints).toBe(8)
    expect(payload.revert).toEqual({
      storyPoints: 2,
      priorityName: 'Baixa',
      assigneeAccountId: 'u-0',
      assigneeName: 'Antigo'
    })
    const row = issueRow(t, 'ABC-1')
    expect(row.story_points).toBe(8)
    expect(row.priority).toBe('Alta')
    expect(t.pushes).toEqual([
      { channel: 'push:queue-changed', payload: { pending: 1, failed: 0 } }
    ])
  })
})

describe('issues:transitions', () => {
  it('lista as transições do Jira', async () => {
    const t = setup({
      issueTransitions: async () => [
        {
          id: '11',
          name: 'Iniciar',
          toStatusId: '3',
          toStatusName: 'Em andamento',
          toCategoryKey: 'indeterminate'
        }
      ]
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:transitions', { key: 'ABC-1' }))
    expect(data.transitions).toEqual([
      { id: '11', name: 'Iniciar', toStatusName: 'Em andamento', toCategoryKey: 'indeterminate' }
    ])
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ issueTransitions: async () => [] })
    expect(err(await invokeHandler('issues:transitions', { key: 'ABC-9' })).code).toBe('NOT_FOUND')
  })
})

describe('issues:transition', () => {
  const transitions = [
    {
      id: '11',
      name: 'Iniciar',
      toStatusId: '3',
      toStatusName: 'Em andamento',
      toCategoryKey: 'indeterminate'
    }
  ]

  it('transiciona e atualiza o status local', async () => {
    const doTransition = vi.fn(async () => {})
    const t = setup({ issueTransitions: async () => transitions, doTransition })
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:transition', { key: 'abc-1', transitionId: '11' }))

    expect(data).toEqual({
      newStatus: 'Em andamento',
      newStatusCategory: 'indeterminate',
      queued: false
    })
    expect(doTransition).toHaveBeenCalledWith('ABC-1', '11')
    expect(issueRow(t, 'ABC-1').status).toBe('Em andamento')
  })

  it('transição inexistente → NO_TRANSITION', async () => {
    const t = setup({ issueTransitions: async () => transitions, doTransition: async () => {} })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(await invokeHandler('issues:transition', { key: 'ABC-1', transitionId: '99' })).code
    ).toBe('NO_TRANSITION')
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ issueTransitions: async () => transitions })
    expect(
      err(await invokeHandler('issues:transition', { key: 'ABC-9', transitionId: '11' })).code
    ).toBe('NOT_FOUND')
  })

  it('sem rede com destino conhecido → enfileira e aplica local', async () => {
    const t = setup({
      issueTransitions: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1', { status: 'A fazer', status_category: 'new' })

    const data = ok(
      await invokeHandler('issues:transition', {
        key: 'ABC-1',
        transitionId: '11',
        toStatusName: 'Em andamento',
        toCategoryKey: 'indeterminate'
      })
    )

    expect(data).toEqual({
      newStatus: 'Em andamento',
      newStatusCategory: 'indeterminate',
      queued: true
    })
    const [action] = pendingActions(t)
    expect(action.type).toBe('transition')
    const payload = JSON.parse(action.payload) as { summary: string; revert: unknown }
    expect(payload.summary).toBe('Mover para Em andamento')
    expect(payload.revert).toEqual({ status: 'A fazer', category: 'new' })
    expect(issueRow(t, 'ABC-1').status).toBe('Em andamento')
    expect(t.pushes[0].channel).toBe('push:queue-changed')
  })

  it('sem rede sem destino conhecido → erro, sem enfileirar', async () => {
    const t = setup({
      issueTransitions: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:transition', { key: 'ABC-1', transitionId: '11' }))
    expect(e.code).toBe('INTERNAL')
    expect(pendingActions(t)).toHaveLength(0)
  })

  it('Jira recusa a transição → TRANSITION_FAILED', async () => {
    const t = setup({
      issueTransitions: async () => transitions,
      doTransition: async () => {
        throw http400({ errorMessages: ['Transição bloqueada'] })
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:transition', { key: 'ABC-1', transitionId: '11' }))
    expect(e.code).toBe('TRANSITION_FAILED')
    expect(e.message).toContain('Transição bloqueada')
  })
})

describe('issues:assignable', () => {
  it('lista os usuários atribuíveis', async () => {
    const t = setup({
      assignableUsers: async () => [{ accountId: 'u-1', displayName: 'Eu Mesmo' }]
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:assignable', { key: 'ABC-1' }))
    expect(data.users).toEqual([{ accountId: 'u-1', displayName: 'Eu Mesmo' }])
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ assignableUsers: async () => [] })
    expect(err(await invokeHandler('issues:assignable', { key: 'ABC-9' })).code).toBe('NOT_FOUND')
  })
})

describe('issues:logWork', () => {
  it('aponta tempo com comentário e devolve o total', async () => {
    const addWorklog = vi.fn(async () => {})
    const t = setup({
      addWorklog,
      issueTimeTracking: async () => ({ timeSpent: '4h', originalEstimate: null })
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '1h 30m', comment: ' oi ' })
    )

    expect(data).toEqual({ ok: true, totalTimeSpent: '4h', queued: false })
    expect(addWorklog).toHaveBeenCalledWith('ABC-1', '1h 30m', expect.objectContaining({}))
  })

  it('sem comentário não manda ADF', async () => {
    const addWorklog = vi.fn(async () => {})
    const t = setup({
      addWorklog,
      issueTimeTracking: async () => ({ timeSpent: '1h', originalEstimate: null })
    })
    seedIssue(t.db, 'ABC-1')

    ok(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '1h', comment: '   ' }))
    expect(addWorklog).toHaveBeenCalledWith('ABC-1', '1h', undefined)
  })

  it('falha ao ler o total → totalTimeSpent null', async () => {
    const t = setup({
      addWorklog: async () => {},
      issueTimeTracking: async () => {
        throw new Error('offline')
      }
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '1h' }))
    expect(data.totalTimeSpent).toBeNull()
  })

  it('sem rede → enfileira worklog', async () => {
    const t = setup({
      addWorklog: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '2h', comment: 'nota' })
    )

    expect(data).toEqual({ ok: true, totalTimeSpent: null, queued: true })
    const [action] = pendingActions(t)
    expect(action.type).toBe('worklog')
    expect(JSON.parse(action.payload)).toMatchObject({
      summary: 'Apontar 2h',
      timeSpent: '2h',
      comment: 'nota'
    })
    expect(t.pushes[0].channel).toBe('push:queue-changed')
  })

  it('sem rede e sem comentário → payload com comment null', async () => {
    const t = setup({
      addWorklog: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1')

    ok(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '2h' }))
    expect(JSON.parse(pendingActions(t)[0].payload)).toMatchObject({ comment: null })
  })

  it('Jira recusa → WORKLOG_FAILED', async () => {
    const t = setup({
      addWorklog: async () => {
        throw http400({ errorMessages: ['sem permissão'] })
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '1h' }))
    expect(e.code).toBe('WORKLOG_FAILED')
    expect(e.message).toContain('sem permissão')
  })

  it('erro genérico sobe', async () => {
    const t = setup({
      addWorklog: async () => {
        throw new Error('quebrou')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(err(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: '1h' }))).toEqual({
      code: 'INTERNAL',
      message: 'quebrou'
    })
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ addWorklog: async () => {} })
    expect(err(await invokeHandler('issues:logWork', { key: 'ABC-9', timeSpent: '1h' })).code).toBe(
      'NOT_FOUND'
    )
  })

  it('formato de tempo inválido → INVALID_PAYLOAD', async () => {
    const t = setup({ addWorklog: async () => {} })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(await invokeHandler('issues:logWork', { key: 'ABC-1', timeSpent: 'duas horas' })).code
    ).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:updateText', () => {
  it('atualiza título e descrição e guarda o markdown local', async () => {
    const updateIssue = vi.fn(async () => {})
    const t = setup({ updateIssue })
    seedIssue(t.db, 'ABC-1')

    ok(
      await invokeHandler('issues:updateText', {
        key: 'abc-1',
        summary: 'Novo título',
        descriptionMarkdown: 'linha **forte**'
      })
    )

    expect(updateIssue).toHaveBeenCalledWith(
      'ABC-1',
      expect.objectContaining({ summary: 'Novo título' })
    )
    const row = issueRow(t, 'ABC-1')
    expect(row.summary).toBe('Novo título')
    expect(row.description_text).toBe('linha **forte**')
  })

  it('nada informado → VALIDATION', async () => {
    setup({ updateIssue: async () => {} })
    expect(err(await invokeHandler('issues:updateText', { key: 'ABC-1' })).code).toBe('VALIDATION')
  })

  it('Jira recusa → UPDATE_FAILED', async () => {
    setup({
      updateIssue: async () => {
        throw http400('não é json')
      }
    })

    const e = err(await invokeHandler('issues:updateText', { key: 'ABC-1', summary: 'x' }))
    expect(e.code).toBe('UPDATE_FAILED')
    expect(e.message).toContain('o Jira respondeu 400')
  })

  it('erro genérico sobe', async () => {
    setup({
      updateIssue: async () => {
        throw new Error('nope')
      }
    })
    expect(err(await invokeHandler('issues:updateText', { key: 'ABC-1', summary: 'x' })).code).toBe(
      'INTERNAL'
    )
  })
})

describe('worklog:list', () => {
  it('marca isMine e normaliza comentário vazio', async () => {
    setup({
      listWorklogs: async () => [
        {
          id: 'w1',
          author: { accountId: 'me-1', displayName: 'Eu Mesmo' },
          started: '2026-01-02T10:00:00.000Z',
          timeSpent: '1h',
          timeSpentSeconds: 3600,
          comment: { type: 'doc', version: 1, content: [] }
        },
        {
          id: 'w2',
          author: null,
          started: '2026-01-01T10:00:00.000Z',
          timeSpent: '2h',
          timeSpentSeconds: 7200
        }
      ],
      issueTimeTracking: async () => ({ timeSpent: '3h', originalEstimate: null })
    })

    const data = ok(await invokeHandler('worklog:list', { key: 'ABC-1' }))

    expect(data.totalTimeSpent).toBe('3h')
    expect(data.worklogs[0]).toMatchObject({ id: 'w1', isMine: true, comment: null })
    expect(data.worklogs[1]).toMatchObject({
      id: 'w2',
      isMine: false,
      authorName: null,
      authorAccountId: null
    })
  })

  it('falha ao ler o total → totalTimeSpent null', async () => {
    setup({
      listWorklogs: async () => [],
      issueTimeTracking: async () => {
        throw new Error('offline')
      }
    })

    const data = ok(await invokeHandler('worklog:list', { key: 'ABC-1' }))
    expect(data).toEqual({ worklogs: [], totalTimeSpent: null })
  })
})

describe('worklog:update', () => {
  it('atualiza e devolve o total', async () => {
    const updateWorklog = vi.fn(async () => {})
    setup({
      updateWorklog,
      issueTimeTracking: async () => ({ timeSpent: '5h', originalEstimate: null })
    })

    const data = ok(
      await invokeHandler('worklog:update', {
        key: 'abc-1',
        worklogId: 'w1',
        timeSpent: '30m',
        comment: 'ajuste'
      })
    )

    expect(data).toEqual({ ok: true, totalTimeSpent: '5h' })
    expect(updateWorklog).toHaveBeenCalledWith(
      'ABC-1',
      'w1',
      '30m',
      expect.objectContaining({ type: 'doc' })
    )
  })

  it('sem comentário manda undefined', async () => {
    const updateWorklog = vi.fn(async () => {})
    setup({
      updateWorklog,
      issueTimeTracking: async () => ({ timeSpent: null, originalEstimate: null })
    })

    ok(await invokeHandler('worklog:update', { key: 'ABC-1', worklogId: 'w1', timeSpent: '30m' }))
    expect(updateWorklog).toHaveBeenCalledWith('ABC-1', 'w1', '30m', undefined)
  })

  it('falha ao ler o total → totalTimeSpent null', async () => {
    setup({
      updateWorklog: async () => {},
      issueTimeTracking: async () => {
        throw new Error('offline')
      }
    })

    const data = ok(
      await invokeHandler('worklog:update', { key: 'ABC-1', worklogId: 'w1', timeSpent: '30m' })
    )
    expect(data).toEqual({ ok: true, totalTimeSpent: null })
  })

  it('Jira recusa → WORKLOG_FAILED', async () => {
    setup({
      updateWorklog: async () => {
        throw http400({ errorMessages: ['não pode'] })
      }
    })

    expect(
      err(await invokeHandler('worklog:update', { key: 'ABC-1', worklogId: 'w1', timeSpent: '1h' }))
        .code
    ).toBe('WORKLOG_FAILED')
  })

  it('erro genérico sobe', async () => {
    setup({
      updateWorklog: async () => {
        throw new Error('x')
      }
    })

    expect(
      err(await invokeHandler('worklog:update', { key: 'ABC-1', worklogId: 'w1', timeSpent: '1h' }))
        .code
    ).toBe('INTERNAL')
  })
})

describe('worklog:delete', () => {
  it('apaga e devolve o total', async () => {
    const deleteWorklog = vi.fn(async () => {})
    setup({
      deleteWorklog,
      issueTimeTracking: async () => ({ timeSpent: '1h', originalEstimate: null })
    })

    const data = ok(await invokeHandler('worklog:delete', { key: 'ABC-1', worklogId: 'w1' }))
    expect(data).toEqual({ ok: true, totalTimeSpent: '1h' })
    expect(deleteWorklog).toHaveBeenCalledWith('ABC-1', 'w1')
  })

  it('falha ao ler o total → totalTimeSpent null', async () => {
    setup({
      deleteWorklog: async () => {},
      issueTimeTracking: async () => {
        throw new Error('offline')
      }
    })

    const data = ok(await invokeHandler('worklog:delete', { key: 'ABC-1', worklogId: 'w1' }))
    expect(data).toEqual({ ok: true, totalTimeSpent: null })
  })

  it('Jira recusa → WORKLOG_FAILED', async () => {
    setup({
      deleteWorklog: async () => {
        throw http400({})
      }
    })

    expect(err(await invokeHandler('worklog:delete', { key: 'ABC-1', worklogId: 'w1' })).code).toBe(
      'WORKLOG_FAILED'
    )
  })

  it('erro genérico sobe', async () => {
    setup({
      deleteWorklog: async () => {
        throw new Error('x')
      }
    })

    expect(err(await invokeHandler('worklog:delete', { key: 'ABC-1', worklogId: 'w1' })).code).toBe(
      'INTERNAL'
    )
  })
})

describe('issues:linkTypes', () => {
  it('lista os tipos de vínculo', async () => {
    setup({
      listIssueLinkTypes: async () => [
        { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' }
      ]
    })

    const data = ok(await invokeHandler('issues:linkTypes', {}))
    expect(data.types).toHaveLength(1)
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issues:linkTypes', {})).code).toBe('NOT_CONNECTED')
  })
})

describe('issues:linkCreate', () => {
  it('direção outward: fromKey é o lado outward', async () => {
    const createIssueLink = vi.fn(async () => {})
    setup({ createIssueLink })

    ok(
      await invokeHandler('issues:linkCreate', {
        fromKey: 'abc-1',
        toKey: 'abc-2',
        typeName: 'Blocks',
        direction: 'outward'
      })
    )

    expect(createIssueLink).toHaveBeenCalledWith('Blocks', 'ABC-2', 'ABC-1')
  })

  it('direção inward inverte os lados', async () => {
    const createIssueLink = vi.fn(async () => {})
    setup({ createIssueLink })

    ok(
      await invokeHandler('issues:linkCreate', {
        fromKey: 'ABC-1',
        toKey: 'ABC-2',
        typeName: 'Blocks',
        direction: 'inward'
      })
    )

    expect(createIssueLink).toHaveBeenCalledWith('Blocks', 'ABC-1', 'ABC-2')
  })

  it('Jira recusa → LINK_FAILED', async () => {
    setup({
      createIssueLink: async () => {
        throw http400({ errorMessages: ['tipo inexistente'] })
      }
    })

    const e = err(
      await invokeHandler('issues:linkCreate', {
        fromKey: 'ABC-1',
        toKey: 'ABC-2',
        typeName: 'X',
        direction: 'outward'
      })
    )
    expect(e.code).toBe('LINK_FAILED')
    expect(e.message).toContain('tipo inexistente')
  })

  it('erro genérico sobe', async () => {
    setup({
      createIssueLink: async () => {
        throw new Error('x')
      }
    })

    expect(
      err(
        await invokeHandler('issues:linkCreate', {
          fromKey: 'ABC-1',
          toKey: 'ABC-2',
          typeName: 'X',
          direction: 'outward'
        })
      ).code
    ).toBe('INTERNAL')
  })
})
