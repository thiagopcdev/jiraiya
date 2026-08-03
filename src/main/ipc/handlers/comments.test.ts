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
const { registerCommentHandlers } = await import('./comments')
const { JiraHttpError } = await import('../../jira/http')
const { AiUnavailableError } = await import('../../ai/types')

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

function netError(): Error {
  return Object.assign(new Error('fetch falhou'), { code: 'ENOTFOUND' })
}

function setup(methods: Fake = {}): Ctx {
  const t = makeTestContext({ client: client(methods) })
  registerCommentHandlers(t.ctx)
  return t
}

function paragraph(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  }
}

/** ADF com `content` string: adfToText devolve '', adfToMarkdown lança. */
const exoticAdf = { type: 'doc', version: 1, content: 'shape estranho' }

beforeEach(() => {
  resetElectronMock()
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run.mockReset()
})

describe('issues:description', () => {
  it('devolve o ADF cru, o markdown e o relator', async () => {
    const issueLiveFields = vi.fn(async () => ({
      description: paragraph('Olá **mundo**'),
      reporter: { accountId: 'a1', displayName: 'Ana' }
    }))
    setup({ issueLiveFields })

    const data = ok(await invokeHandler('issues:description', { key: 'abc-1' }))

    expect(issueLiveFields).toHaveBeenCalledWith('ABC-1')
    expect(data.markdown).toBe('Olá **mundo**')
    expect(data.description).not.toBeNull()
    expect(data.reporterName).toBe('Ana')
  })

  it('descrição vazia → markdown null', async () => {
    setup({ issueLiveFields: async () => ({ description: null, reporter: null }) })

    const data = ok(await invokeHandler('issues:description', { key: 'ABC-1' }))
    expect(data).toEqual({ description: null, markdown: null, reporterName: null })
  })

  it('ADF exótico → markdown cai no fallback null', async () => {
    setup({ issueLiveFields: async () => ({ description: exoticAdf, reporter: null }) })

    const data = ok(await invokeHandler('issues:description', { key: 'ABC-1' }))
    expect(data.markdown).toBeNull()
  })

  it('sem client → NOT_CONNECTED', async () => {
    const t = setup()
    t.setClient(null)
    expect(err(await invokeHandler('issues:description', { key: 'ABC-1' })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup({ issueLiveFields: async () => ({ description: null, reporter: null }) })
    t.db.prepare('DELETE FROM workspace').run()
    expect(err(await invokeHandler('issues:description', { key: 'ABC-1' })).code).toBe(
      'NOT_CONNECTED'
    )
  })

  it('payload inválido → INVALID_PAYLOAD', async () => {
    setup()
    expect(err(await invokeHandler('issues:description', { key: '' })).code).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:comments', () => {
  it('ordena do mais recente para o mais antigo e mapeia autor', async () => {
    setup({
      issueComments: async () => [
        {
          id: 'c1',
          author: { accountId: 'u-1', displayName: 'Alguém' },
          created: '2026-01-01T10:00:00.000Z',
          body: paragraph('antigo')
        },
        {
          id: 'c2',
          author: null,
          created: '2026-02-01T10:00:00.000Z',
          body: paragraph('novo')
        }
      ]
    })

    const data = ok(await invokeHandler('issues:comments', { key: 'ABC-1' }))

    expect(data.comments.map((c) => c.id)).toEqual(['c2', 'c1'])
    expect(data.comments[0]).toMatchObject({
      authorAccountId: null,
      authorName: null,
      bodyText: 'novo',
      bodyMarkdown: 'novo'
    })
    expect(data.comments[1]).toMatchObject({ authorName: 'Alguém' })
  })

  it('comentário sem body e com ADF exótico não quebra', async () => {
    setup({
      issueComments: async () => [
        { id: 'c1', created: '2026-01-01T10:00:00.000Z' },
        { id: 'c2', created: '2026-01-02T10:00:00.000Z', body: exoticAdf }
      ]
    })

    const data = ok(await invokeHandler('issues:comments', { key: 'ABC-1' }))
    expect(data.comments.map((c) => c.bodyMarkdown)).toEqual(['', ''])
    expect(data.comments[1].body).toBeNull()
  })
})

describe('issues:commentDraft', () => {
  it('gera o rascunho com o provider ativo', async () => {
    ai.run.mockResolvedValue('### Resumo\ntexto')
    const t = setup()
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:commentDraft', { issueKey: 'abc-1', notes: 'notas soltas' })
    )

    expect(data).toEqual({ body: '### Resumo\ntexto', generatedBy: 'claude' })
    expect(ai.run).toHaveBeenCalledWith('comment', expect.stringContaining('notas soltas'))
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup()
    expect(
      err(await invokeHandler('issues:commentDraft', { issueKey: 'ABC-9', notes: 'x' })).code
    ).toBe('NOT_FOUND')
  })

  it('sem provider de IA → AI_UNAVAILABLE', async () => {
    ai.provider = null
    const t = setup()
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:commentDraft', { issueKey: 'ABC-1', notes: 'x' }))
    expect(e.code).toBe('AI_UNAVAILABLE')
    expect(e.message).toContain('Nenhum provider')
  })

  it('IA falha → AI_UNAVAILABLE com a mensagem do provider', async () => {
    ai.run.mockRejectedValue(new AiUnavailableError('CLI não encontrada'))
    const t = setup()
    seedIssue(t.db, 'ABC-1')

    const e = err(await invokeHandler('issues:commentDraft', { issueKey: 'ABC-1', notes: 'x' }))
    expect(e).toEqual({ code: 'AI_UNAVAILABLE', message: 'CLI não encontrada' })
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    const t = setup()
    t.db.prepare('DELETE FROM workspace').run()
    expect(
      err(await invokeHandler('issues:commentDraft', { issueKey: 'ABC-1', notes: 'x' })).code
    ).toBe('NOT_CONNECTED')
  })
})

describe('issues:comment', () => {
  it('publica o comentário convertido para ADF', async () => {
    const addComment = vi.fn(async () => {})
    const t = setup({ addComment })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:comment', { issueKey: 'abc-1', body: 'linha **forte**' })
    )

    expect(data).toEqual({ ok: true, queued: false })
    expect(addComment).toHaveBeenCalledWith('ABC-1', expect.objectContaining({ type: 'doc' }))
  })

  it('sem rede → enfileira com o markdown cru', async () => {
    const t = setup({
      addComment: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1')

    const data = ok(await invokeHandler('issues:comment', { issueKey: 'ABC-1', body: 'oi' }))

    expect(data).toEqual({ ok: true, queued: true })
    const row = t.db.prepare('SELECT type, issue_key, payload FROM pending_action').get() as {
      type: string
      issue_key: string
      payload: string
    }
    expect(row).toMatchObject({ type: 'comment', issue_key: 'ABC-1' })
    expect(JSON.parse(row.payload)).toEqual({ summary: 'Comentar: "oi"', body: 'oi' })
    expect(t.pushes).toEqual([
      { channel: 'push:queue-changed', payload: { pending: 1, failed: 0 } }
    ])
  })

  it('resumo da fila trunca comentário longo', async () => {
    const t = setup({
      addComment: async () => {
        throw netError()
      }
    })
    seedIssue(t.db, 'ABC-1')
    const body = 'a'.repeat(100)

    ok(await invokeHandler('issues:comment', { issueKey: 'ABC-1', body }))

    const payload = JSON.parse(
      (t.db.prepare('SELECT payload FROM pending_action').get() as { payload: string }).payload
    ) as { summary: string }
    expect(payload.summary).toBe(`Comentar: "${'a'.repeat(60)}…"`)
  })

  it('erro de negócio sobe (não enfileira)', async () => {
    const t = setup({
      addComment: async () => {
        throw new JiraHttpError(403, 'sem permissão')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(err(await invokeHandler('issues:comment', { issueKey: 'ABC-1', body: 'oi' })).code).toBe(
      'JIRA_HTTP'
    )
    expect(t.db.prepare('SELECT COUNT(*) c FROM pending_action').get()).toEqual({ c: 0 })
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ addComment: async () => {} })
    expect(err(await invokeHandler('issues:comment', { issueKey: 'ABC-9', body: 'oi' })).code).toBe(
      'NOT_FOUND'
    )
  })

  it('corpo vazio → INVALID_PAYLOAD', async () => {
    const t = setup({ addComment: async () => {} })
    seedIssue(t.db, 'ABC-1')
    expect(
      err(await invokeHandler('issues:comment', { issueKey: 'ABC-1', body: '   ' })).code
    ).toBe('INVALID_PAYLOAD')
  })
})

describe('issues:commentUpdate', () => {
  it('edita o comentário', async () => {
    const updateComment = vi.fn(async () => {})
    const t = setup({ updateComment })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:commentUpdate', {
        issueKey: 'abc-1',
        commentId: 'c1',
        body: 'novo texto'
      })
    )

    expect(data).toEqual({ ok: true })
    expect(updateComment).toHaveBeenCalledWith(
      'ABC-1',
      'c1',
      expect.objectContaining({ type: 'doc' })
    )
  })

  it('Jira recusa → COMMENT_FAILED', async () => {
    const t = setup({
      updateComment: async () => {
        throw new JiraHttpError(400, 'Bad Request', JSON.stringify({ errorMessages: ['nope'] }))
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(
      await invokeHandler('issues:commentUpdate', {
        issueKey: 'ABC-1',
        commentId: 'c1',
        body: 'x'
      })
    )
    expect(e.code).toBe('COMMENT_FAILED')
    expect(e.message).toContain('nope')
  })

  it('erro genérico sobe', async () => {
    const t = setup({
      updateComment: async () => {
        throw new Error('boom')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(
        await invokeHandler('issues:commentUpdate', {
          issueKey: 'ABC-1',
          commentId: 'c1',
          body: 'x'
        })
      ).code
    ).toBe('INTERNAL')
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ updateComment: async () => {} })
    expect(
      err(
        await invokeHandler('issues:commentUpdate', {
          issueKey: 'ABC-9',
          commentId: 'c1',
          body: 'x'
        })
      ).code
    ).toBe('NOT_FOUND')
  })
})

describe('issues:commentDelete', () => {
  it('apaga o comentário', async () => {
    const deleteComment = vi.fn(async () => {})
    const t = setup({ deleteComment })
    seedIssue(t.db, 'ABC-1')

    const data = ok(
      await invokeHandler('issues:commentDelete', { issueKey: 'ABC-1', commentId: 'c1' })
    )

    expect(data).toEqual({ ok: true })
    expect(deleteComment).toHaveBeenCalledWith('ABC-1', 'c1')
  })

  it('Jira recusa → COMMENT_FAILED', async () => {
    const t = setup({
      deleteComment: async () => {
        throw new JiraHttpError(400, 'Bad Request', 'corpo não-json')
      }
    })
    seedIssue(t.db, 'ABC-1')

    const e = err(
      await invokeHandler('issues:commentDelete', { issueKey: 'ABC-1', commentId: 'c1' })
    )
    expect(e.code).toBe('COMMENT_FAILED')
    expect(e.message).toContain('o Jira respondeu 400')
  })

  it('erro genérico sobe', async () => {
    const t = setup({
      deleteComment: async () => {
        throw new Error('boom')
      }
    })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(await invokeHandler('issues:commentDelete', { issueKey: 'ABC-1', commentId: 'c1' })).code
    ).toBe('INTERNAL')
  })

  it('card fora do cache → NOT_FOUND', async () => {
    setup({ deleteComment: async () => {} })
    expect(
      err(await invokeHandler('issues:commentDelete', { issueKey: 'ABC-9', commentId: 'c1' })).code
    ).toBe('NOT_FOUND')
  })

  // 404 de comentário já apagado não pode ser confundido com card excluído
  it('404 do comentário com o card vivo → COMMENT_FAILED, card intacto', async () => {
    const t = setup({
      deleteComment: async () => {
        throw new JiraHttpError(404, 'Jira respondeu 404')
      },
      issueExists: async () => true
    })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(await invokeHandler('issues:commentDelete', { issueKey: 'ABC-1', commentId: 'c1' })).code
    ).toBe('COMMENT_FAILED')
    expect(t.db.prepare('SELECT key FROM issue WHERE key = ?').get('ABC-1')).toEqual({
      key: 'ABC-1'
    })
  })

  it('404 com o card excluído no Jira → ISSUE_GONE', async () => {
    const t = setup({
      deleteComment: async () => {
        throw new JiraHttpError(404, 'Jira respondeu 404')
      },
      issueExists: async () => false
    })
    seedIssue(t.db, 'ABC-1')

    expect(
      err(await invokeHandler('issues:commentDelete', { issueKey: 'ABC-1', commentId: 'c1' })).code
    ).toBe('ISSUE_GONE')
    expect(t.db.prepare('SELECT key FROM issue WHERE key = ?').get('ABC-1')).toBeUndefined()
  })
})
