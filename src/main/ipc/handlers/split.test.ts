import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClient } from '../../jira/client'

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
const { JiraHttpError } = await import('../../jira/http')
const { registerSplitHandlers } = await import('./split')

let t: ReturnType<typeof makeTestContext>

const AI_RESPONSE = JSON.stringify({
  items: [
    { title: '[Front] Tela de login', description: '### Contexto\nx' },
    { title: '[Back] Endpoint de login', description: '' }
  ],
  rationale: 'Separei front e back para entregar isolado.'
})

const ITEMS = [
  { title: 'Parte 1', description: '### Contexto\nprimeira parte' },
  { title: 'Parte 2', description: '' }
]

beforeEach(() => {
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run = async () => AI_RESPONSE
  t = makeTestContext()
  registerSplitHandlers(t.ctx)
})

describe('issues:splitDraft', () => {
  it('devolve itens, racional e o provider usado', async () => {
    seedIssue(t.db, 'BT-1', { description_text: 'card grande' })

    const res = await invokeHandler('issues:splitDraft', { parentKey: 'bt-1' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.items).toHaveLength(2)
    expect(res.data.rationale).toContain('Separei')
    expect(res.data.generatedBy).toBe('claude')
  })

  it('itera com feedback e itens já editados', async () => {
    seedIssue(t.db, 'BT-1')
    const prompts: string[] = []
    ai.run = async (_feature, prompt) => {
      prompts.push(prompt)
      return AI_RESPONSE
    }

    const res = await invokeHandler('issues:splitDraft', {
      parentKey: 'BT-1',
      feedback: 'junte os dois primeiros',
      currentItems: ITEMS
    })
    expect(res.ok).toBe(true)
    expect(prompts[0]).toContain('FEEDBACK DO USUÁRIO')
    expect(prompts[0]).toContain('junte os dois primeiros')
  })

  it('card fora do cache local → NOT_FOUND', async () => {
    const res = await invokeHandler('issues:splitDraft', { parentKey: 'BT-404' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_FOUND')
  })

  it('sem provider de IA → AI_UNAVAILABLE', async () => {
    seedIssue(t.db, 'BT-1')
    ai.provider = null
    const res = await invokeHandler('issues:splitDraft', { parentKey: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
  })

  it('resposta impossível de parsear → AI_UNAVAILABLE', async () => {
    seedIssue(t.db, 'BT-1')
    ai.run = async () => 'desculpa, não consegui'
    const res = await invokeHandler('issues:splitDraft', { parentKey: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('issues:splitDraft', { parentKey: 'BT-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})

describe('issues:split', () => {
  interface Created {
    fields: Record<string, unknown>
  }

  function clientOk(opts: { commentFails?: boolean } = {}): {
    client: Partial<JiraClient>
    created: Created[]
    comments: unknown[]
  } {
    const created: Created[] = []
    const comments: unknown[] = []
    return {
      created,
      comments,
      client: {
        createIssue: async (fields: Record<string, unknown>) => {
          created.push({ fields })
          return { id: `id-${created.length}`, key: `BT-${100 + created.length}` } as never
        },
        addComment: async (_key: string, body: unknown) => {
          if (opts.commentFails) throw new Error('sem permissão de comentário')
          comments.push(body)
        }
      }
    }
  }

  it('modo subtask cria os filhos com parent e comenta no card original', async () => {
    seedIssue(t.db, 'BT-1')
    const { client, created, comments } = clientOk()
    t.setClient(client)

    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: ITEMS
    })
    expect(res.ok && res.data).toEqual({ keys: ['BT-101', 'BT-102'], commentPosted: true })
    expect(created).toHaveLength(2)
    expect(created[0].fields).toMatchObject({
      project: { key: 'BT' },
      issuetype: { id: '10003' },
      summary: 'Parte 1',
      parent: { key: 'BT-1' }
    })
    // item sem descrição não manda o campo description
    expect(created[1].fields.description).toBeUndefined()
    expect(comments).toHaveLength(1)
  })

  it('modo sibling não manda parent e assignToMe usa a conta do workspace', async () => {
    seedIssue(t.db, 'BT-1')
    const { client, created } = clientOk()
    t.setClient(client)

    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'sibling',
      issueTypeId: '10001',
      items: [ITEMS[0]],
      assignToMe: true
    })
    expect(res.ok).toBe(true)
    expect(created[0].fields.parent).toBeUndefined()
    expect(created[0].fields.assignee).toEqual({ id: 'me-1' })
  })

  it('comentário que falha não invalida a divisão', async () => {
    seedIssue(t.db, 'BT-1')
    t.setClient(clientOk({ commentFails: true }).client)

    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: [ITEMS[0]]
    })
    expect(res.ok && res.data).toEqual({ keys: ['BT-101'], commentPosted: false })
  })

  it('falha no 2º item → JIRA_SPLIT listando o que já foi criado', async () => {
    seedIssue(t.db, 'BT-1')
    let calls = 0
    t.setClient({
      createIssue: async () => {
        calls++
        if (calls === 1) return { id: 'id-1', key: 'BT-101' } as never
        throw new JiraHttpError(
          400,
          'bad request',
          JSON.stringify({ errors: { summary: 'campo obrigatório' } })
        )
      }
    })

    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: ITEMS
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('JIRA_SPLIT')
    expect(res.message).toContain('Falha no item 2')
    expect(res.message).toContain('summary: campo obrigatório')
    expect(res.message).toContain('BT-101')
  })

  it('falha no 1º item → JIRA_SPLIT avisando que nada foi criado', async () => {
    seedIssue(t.db, 'BT-1')
    t.setClient({
      createIssue: async () => {
        throw new Error('rede caiu')
      }
    })

    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: [ITEMS[0]]
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toContain('Nenhum card foi criado')
    expect(res.message).toContain('rede caiu')
  })

  it('card pai fora do cache local → NOT_FOUND', async () => {
    t.setClient(clientOk().client)
    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-404',
      mode: 'subtask',
      issueTypeId: '10003',
      items: [ITEMS[0]]
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_FOUND')
  })

  it('sem client → NOT_CONNECTED', async () => {
    seedIssue(t.db, 'BT-1')
    t.setClient(null)
    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: [ITEMS[0]]
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })

  it('lista de itens vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('issues:split', {
      parentKey: 'BT-1',
      mode: 'subtask',
      issueTypeId: '10003',
      items: []
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
