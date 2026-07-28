import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext, seedIssue } = await import('../../testing/handlersKit')
const { registerSearchHandlers } = await import('./search')

let t: ReturnType<typeof makeTestContext>

beforeEach(() => {
  t = makeTestContext()
  registerSearchHandlers(t.ctx)
})

describe('search:global', () => {
  it('encontra pelo título e monta a URL de browse', async () => {
    seedIssue(t.db, 'BT-1', { summary: 'Corrigir bug de login' })
    seedIssue(t.db, 'BT-2', { summary: 'Outro assunto' })

    const res = await invokeHandler('search:global', { query: 'login' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.results).toHaveLength(1)
    expect(res.data.results[0]).toMatchObject({
      key: 'BT-1',
      match: 'title',
      url: 'https://x.atlassian.net/browse/BT-1'
    })
  })

  it('encontra pela descrição e traz snippet destacado', async () => {
    seedIssue(t.db, 'BT-3', {
      summary: 'Assunto genérico',
      description_text: 'precisamos revisar o webhook de pagamento'
    })

    const res = await invokeHandler('search:global', { query: 'webhook' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.results[0].match).toBe('description')
    expect(res.data.results[0].snippet).toContain('「')
  })

  it('respeita o limit informado', async () => {
    seedIssue(t.db, 'BT-10', { summary: 'login um' })
    seedIssue(t.db, 'BT-11', { summary: 'login dois' })

    const res = await invokeHandler('search:global', { query: 'login', limit: 1 })
    expect(res.ok && res.data.results).toHaveLength(1)
  })

  it('termo sem resultado → lista vazia', async () => {
    const res = await invokeHandler('search:global', { query: 'inexistente' })
    expect(res.ok && res.data.results).toEqual([])
  })

  it('query com menos de 2 caracteres → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('search:global', { query: 'a' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('sem workspace → NOT_CONNECTED', async () => {
    t.db.prepare('DELETE FROM workspace').run()
    const res = await invokeHandler('search:global', { query: 'login' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('NOT_CONNECTED')
  })
})
