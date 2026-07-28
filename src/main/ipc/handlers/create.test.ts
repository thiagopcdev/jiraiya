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
const { makeTestContext } = await import('../../testing/handlersKit')
const { parseCreateError, registerCreateHandlers } = await import('./create')
const { upsertSprints } = await import('../../db/repos/catalog')
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
  registerCreateHandlers(t.ctx)
  return t
}

function baseCreate(): {
  projectKey: string
  issueTypeId: string
  summary: string
  description: string
} {
  return { projectKey: 'ABC', issueTypeId: '10001', summary: 'Novo card', description: '' }
}

beforeEach(() => {
  resetElectronMock()
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run.mockReset()
})

describe('issueTypes:list', () => {
  it('esconde subtarefas por padrão', async () => {
    const listCreateIssueTypes = vi.fn(async () => [
      { id: '1', name: 'Tarefa', subtask: false },
      { id: '2', name: 'Subtarefa', subtask: true },
      { id: '3', name: 'História' }
    ])
    setup({ listCreateIssueTypes })

    const data = ok(await invokeHandler('issueTypes:list', { projectKey: 'ABC' }))

    expect(listCreateIssueTypes).toHaveBeenCalledWith('ABC')
    expect(data.issueTypes).toEqual([
      { id: '1', name: 'Tarefa', subtask: false },
      { id: '3', name: 'História', subtask: false }
    ])
  })

  it('includeSubtasks traz as subtarefas', async () => {
    setup({
      listCreateIssueTypes: async () => [
        { id: '1', name: 'Tarefa', subtask: false },
        { id: '2', name: 'Subtarefa', subtask: true }
      ]
    })

    const data = ok(
      await invokeHandler('issueTypes:list', { projectKey: 'ABC', includeSubtasks: true })
    )
    expect(data.issueTypes.map((t) => t.subtask)).toEqual([false, true])
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issueTypes:list', { projectKey: 'ABC' })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('projectKey vazio → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issueTypes:list', { projectKey: '' })).code).toBe(
      'INVALID_PAYLOAD'
    )
  })
})

describe('issues:draft', () => {
  it('gera título e descrição com o provider ativo', async () => {
    ai.run.mockResolvedValue('{"title":"Corrigir login","description":"### Contexto\\ndetalhe"}')
    setup()

    const data = ok(
      await invokeHandler('issues:draft', {
        idea: 'login quebrado',
        projectKey: 'ABC',
        issueType: 'Bug'
      })
    )

    expect(data).toEqual({
      title: 'Corrigir login',
      description: '### Contexto\ndetalhe',
      generatedBy: 'claude'
    })
    expect(ai.run).toHaveBeenCalledWith('draft', expect.stringContaining('login quebrado'))
  })

  it('sem provider → AI_UNAVAILABLE', async () => {
    ai.provider = null
    setup()

    const e = err(
      await invokeHandler('issues:draft', { idea: 'x', projectKey: 'ABC', issueType: 'Bug' })
    )
    expect(e.code).toBe('AI_UNAVAILABLE')
    expect(e.message).toContain('Nenhum provider')
  })

  it('resposta fora do formato → AI_UNAVAILABLE', async () => {
    ai.run.mockResolvedValue('não é json')
    setup()

    const e = err(
      await invokeHandler('issues:draft', { idea: 'x', projectKey: 'ABC', issueType: 'Bug' })
    )
    expect(e).toEqual({ code: 'AI_UNAVAILABLE', message: 'Resposta da IA em formato inesperado' })
  })

  it('ideia vazia → INVALID_PAYLOAD', async () => {
    setup()
    expect(
      err(await invokeHandler('issues:draft', { idea: '', projectKey: 'ABC', issueType: 'Bug' }))
        .code
    ).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:create', () => {
  it('monta os campos mínimos e atribui a mim por padrão', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-10' })
    )
    setup({ createIssue })

    const data = ok(await invokeHandler('issues:create', baseCreate()))

    expect(data).toEqual({ key: 'ABC-10' })
    expect(createIssue).toHaveBeenCalledWith({
      project: { key: 'ABC' },
      issuetype: { id: '10001' },
      summary: 'Novo card',
      assignee: { id: 'me-1' }
    })
  })

  it('assignToMe false não manda assignee', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-10' })
    )
    setup({ createIssue })

    ok(await invokeHandler('issues:create', { ...baseCreate(), assignToMe: false }))

    expect(createIssue).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignee: expect.anything() })
    )
  })

  it('descrição em markdown vira ADF e parentKey é normalizado', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-11' })
    )
    setup({ createIssue })

    ok(
      await invokeHandler('issues:create', {
        ...baseCreate(),
        description: 'linha **forte**',
        parentKey: ' abc-1 '
      })
    )

    const fields = createIssue.mock.calls[0][0] as Record<string, unknown>
    expect(fields.parent).toEqual({ key: 'ABC-1' })
    expect(fields.description).toMatchObject({ type: 'doc' })
  })

  it('descrição só com espaços não vira campo', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-11' })
    )
    setup({ createIssue })

    ok(await invokeHandler('issues:create', { ...baseCreate(), description: '   ' }))
    expect(createIssue.mock.calls[0][0]).not.toHaveProperty('description')
  })

  it('addToActiveSprint usa o id da sprint ativa', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-12' })
    )
    const t = setup({ createIssue })
    t.db
      .prepare(
        `UPDATE workspace SET sprint_field_id = 'customfield_10020',
         story_points_field_id = 'customfield_10016' WHERE id = 1`
      )
      .run()
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

    ok(
      await invokeHandler('issues:create', {
        ...baseCreate(),
        addToActiveSprint: true,
        storyPoints: 3
      })
    )

    expect(createIssue.mock.calls[0][0]).toMatchObject({
      customfield_10020: 70,
      customfield_10016: 3
    })
  })

  it('addToActiveSprint sem campo configurado é ignorado', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-13' })
    )
    const t = setup({ createIssue })
    t.db.prepare(`UPDATE workspace SET sprint_field_id = 'none' WHERE id = 1`).run()

    ok(await invokeHandler('issues:create', { ...baseCreate(), addToActiveSprint: true }))
    expect(createIssue.mock.calls[0][0]).toEqual({
      project: { key: 'ABC' },
      issuetype: { id: '10001' },
      summary: 'Novo card',
      assignee: { id: 'me-1' }
    })
  })

  it('sprint ativa ausente não adiciona o campo', async () => {
    const createIssue = vi.fn<(fields: Record<string, unknown>) => Promise<{ key: string }>>(
      async () => ({ key: 'ABC-14' })
    )
    const t = setup({ createIssue })
    t.db.prepare(`UPDATE workspace SET sprint_field_id = 'customfield_10020' WHERE id = 1`).run()

    ok(await invokeHandler('issues:create', { ...baseCreate(), addToActiveSprint: true }))
    expect(createIssue.mock.calls[0][0]).not.toHaveProperty('customfield_10020')
  })

  it('400 do Jira → JIRA_CREATE com a mensagem parseada', async () => {
    setup({
      createIssue: async () => {
        throw new JiraHttpError(
          400,
          'Bad Request',
          JSON.stringify({
            errorMessages: ['tipo inválido'],
            errors: { summary: 'obrigatório' }
          })
        )
      }
    })

    const e = err(await invokeHandler('issues:create', baseCreate()))
    expect(e.code).toBe('JIRA_CREATE')
    expect(e.message).toContain('tipo inválido; summary: obrigatório')
  })

  it('erro HTTP não-400 sobe como JIRA_HTTP', async () => {
    setup({
      createIssue: async () => {
        throw new JiraHttpError(500, 'Server Error')
      }
    })

    expect(err(await invokeHandler('issues:create', baseCreate())).code).toBe('JIRA_HTTP')
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issues:create', baseCreate())).code).toBe('NOT_CONNECTED')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup({ createIssue: async () => ({ key: 'x' }) })
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('issues:create', baseCreate())).code).toBe('NOT_CONNECTED')
  })

  it('summary vazio → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issues:create', { ...baseCreate(), summary: '' })).code).toBe(
      'INVALID_PAYLOAD'
    )
  })
})

describe('parseCreateError', () => {
  it('corpo não-JSON cai no fallback com o status', () => {
    expect(parseCreateError(new JiraHttpError(400, 'Bad', '<html>erro</html>'))).toBe(
      'o Jira respondeu 400'
    )
  })

  it('JSON sem mensagens cai no fallback', () => {
    expect(parseCreateError(new JiraHttpError(422, 'x', JSON.stringify({ outro: 1 })))).toBe(
      'o Jira respondeu 422'
    )
  })

  it('junta errorMessages e errors', () => {
    const err400 = new JiraHttpError(
      400,
      'Bad',
      JSON.stringify({ errorMessages: ['a'], errors: { campo: 'b' } })
    )
    expect(parseCreateError(err400)).toBe('a; campo: b')
  })
})
