import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JiraClient } from '../jira/client'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

const { makeTestContext, seedIssue } = await import('../testing/handlersKit')
const { isMaybeIssueGoneError, issueKeyFromPayload, makeIssueGoneResolver, purgeIfIssueGone } =
  await import('./gone')
const { JiraAuthError, JiraHttpError } = await import('../jira/http')
const { getIssueByKey } = await import('../db/repos/issue')

type Ctx = ReturnType<typeof makeTestContext>

function setup(issueExists?: (key: string) => Promise<boolean>): Ctx {
  return makeTestContext({
    client: (issueExists ? { issueExists } : {}) as unknown as Partial<JiraClient>
  })
}

describe('isMaybeIssueGoneError', () => {
  it('404 do Jira é candidato', () => {
    expect(isMaybeIssueGoneError(new JiraHttpError(404, 'Jira respondeu 404'))).toBe(true)
  })

  it('401/403 não são (é credencial, não card apagado)', () => {
    expect(isMaybeIssueGoneError(new JiraAuthError(403))).toBe(false)
  })

  it('outros status e erros comuns não são', () => {
    expect(isMaybeIssueGoneError(new JiraHttpError(400, 'Jira respondeu 400'))).toBe(false)
    expect(isMaybeIssueGoneError(new JiraHttpError(500, 'Jira respondeu 500'))).toBe(false)
    expect(isMaybeIssueGoneError(new Error('404'))).toBe(false)
    expect(isMaybeIssueGoneError(null)).toBe(false)
  })
})

describe('issueKeyFromPayload', () => {
  it('lê key e issueKey, normalizando', () => {
    expect(issueKeyFromPayload({ key: ' bt-907 ' })).toBe('BT-907')
    expect(issueKeyFromPayload({ issueKey: 'bt-907' })).toBe('BT-907')
  })

  it('issueKey ganha de key (canais que levam os dois)', () => {
    expect(issueKeyFromPayload({ issueKey: 'BT-1', key: 'BT-2' })).toBe('BT-1')
  })

  it('texto que não é key -> null', () => {
    expect(issueKeyFromPayload({ key: 'bugs' })).toBeNull()
    expect(issueKeyFromPayload({ key: '' })).toBeNull()
    expect(issueKeyFromPayload({ key: 42 })).toBeNull()
    expect(issueKeyFromPayload({})).toBeNull()
    expect(issueKeyFromPayload(null)).toBeNull()
  })
})

describe('purgeIfIssueGone', () => {
  let t: Ctx

  beforeEach(() => {
    t = setup(async () => false)
    seedIssue(t.db, 'BT-907')
  })

  it('confirmou que sumiu -> apaga o card, avisa o renderer e devolve a mensagem', async () => {
    const message = await purgeIfIssueGone(t.ctx, 1, 'BT-907')
    expect(message).toContain('BT-907')
    expect(getIssueByKey(t.db, 1, 'BT-907')).toBeNull()
    expect(t.pushes).toEqual([{ channel: 'push:issue-gone', payload: { key: 'BT-907' } }])
  })

  it('card ainda existe (404 veio de sub-recurso) -> não apaga nada', async () => {
    t.setClient({ issueExists: async () => true } as unknown as Partial<JiraClient>)
    expect(await purgeIfIssueGone(t.ctx, 1, 'BT-907')).toBeNull()
    expect(getIssueByKey(t.db, 1, 'BT-907')).not.toBeNull()
    expect(t.pushes).toEqual([])
  })

  it('confirmação falhou (rede/5xx) -> mantém o cache', async () => {
    t.setClient({
      issueExists: async () => {
        throw new JiraHttpError(500, 'Jira respondeu 500')
      }
    } as unknown as Partial<JiraClient>)
    expect(await purgeIfIssueGone(t.ctx, 1, 'BT-907')).toBeNull()
    expect(getIssueByKey(t.db, 1, 'BT-907')).not.toBeNull()
  })

  it('sem client conectado -> não apaga', async () => {
    t.setClient(null)
    expect(await purgeIfIssueGone(t.ctx, 1, 'BT-907')).toBeNull()
    expect(getIssueByKey(t.db, 1, 'BT-907')).not.toBeNull()
  })

  it('card que nem está em cache -> não chama o Jira', async () => {
    const issueExists = vi.fn(async () => false)
    t.setClient({ issueExists } as unknown as Partial<JiraClient>)
    expect(await purgeIfIssueGone(t.ctx, 1, 'BT-999')).toBeNull()
    expect(issueExists).not.toHaveBeenCalled()
  })
})

describe('makeIssueGoneResolver', () => {
  it('resolve o workspace e purga', async () => {
    const t = setup(async () => false)
    seedIssue(t.db, 'BT-907')
    const resolver = makeIssueGoneResolver(t.ctx)
    expect(await resolver('BT-907')).toContain('BT-907')
    expect(getIssueByKey(t.db, 1, 'BT-907')).toBeNull()
  })

  it('sem workspace conectado -> null', async () => {
    const t = setup(async () => false)
    t.db.prepare('DELETE FROM workspace').run()
    expect(await makeIssueGoneResolver(t.ctx)('BT-907')).toBeNull()
  })
})
