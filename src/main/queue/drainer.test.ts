import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { AppContext } from '../appContext'
import type { JiraClient } from '../jira/client'
import { runMigrations } from '../db/migrations'
import { JiraHttpError } from '../jira/http'
import { shownNotifications, resetElectronMock } from '../testing/electronMock'
import { upsertIssue } from '../db/repos/issue'
import { enqueueAction, listActions } from './repo'
import { drainQueue } from './drainer'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

interface FakeClient {
  addComment: ReturnType<typeof vi.fn>
  issueTransitions: ReturnType<typeof vi.fn>
  doTransition: ReturnType<typeof vi.fn>
  addWorklog: ReturnType<typeof vi.fn>
  updateIssue: ReturnType<typeof vi.fn>
}

function fakeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    addComment: vi.fn(async () => undefined),
    issueTransitions: vi.fn(async () => [
      { id: '31', name: 'Mover', toStatusName: 'Em andamento', toCategoryKey: 'indeterminate' }
    ]),
    doTransition: vi.fn(async () => undefined),
    addWorklog: vi.fn(async () => undefined),
    updateIssue: vi.fn(async () => undefined),
    ...over
  }
}

/** Promise controlada pelo teste (para segurar um drain no meio). */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let db: Database.Database
let pushed: Array<{ channel: string; payload: unknown }>

function ctxWith(client: FakeClient | null): AppContext {
  return {
    db,
    getClient: () => client as unknown as JiraClient | null,
    push: (channel: string, payload: unknown) => pushed.push({ channel, payload })
  } as unknown as AppContext
}

function insertIssue(key: string): void {
  upsertIssue(db, 1, {
    jiraId: '1000',
    key,
    projectKey: 'BT',
    summary: 'Card',
    descriptionText: null,
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: 'High',
    assigneeAccountId: 'acc-1',
    assigneeName: 'Eu',
    reporterAccountId: 'acc-1',
    reporterName: null,
    storyPoints: 5,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-02T10:00:00.000Z',
    resolvedAt: null
  })
}

function transitionPayload(): Record<string, unknown> {
  return {
    summary: 'Mover para Em andamento',
    transitionId: '31',
    toStatusName: 'Em andamento',
    toCategoryKey: 'indeterminate',
    revert: { status: 'A fazer', category: 'new' }
  }
}

beforeEach(() => {
  resetElectronMock()
  pushed = []
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, story_points_field_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'customfield_10016', 'now')`
  ).run()
})

describe('drainQueue — guardas', () => {
  it('sem workspace não faz nada', () => {
    const emptyDb = new Database(':memory:')
    runMigrations(emptyDb)
    const ctx = {
      db: emptyDb,
      getClient: () => fakeClient() as unknown as JiraClient,
      push: () => {}
    } as unknown as AppContext

    return expect(drainQueue(ctx)).resolves.toEqual({ sent: 0, failed: 0 })
  })

  it('desconectado (sem client) não faz nada e não notifica', async () => {
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    await expect(drainQueue(ctxWith(null))).resolves.toEqual({ sent: 0, failed: 0 })
    expect(listActions(db, 1)[0].status).toBe('pending')
    expect(pushed).toEqual([])
  })

  it('drain concorrente é ignorado (o segundo devolve zeros)', async () => {
    const emEspera = deferred()
    const client = fakeClient({ addComment: vi.fn(() => emEspera.promise) })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    const first = drainQueue(ctxWith(client))
    await vi.waitFor(() => expect(client.addComment).toHaveBeenCalled())
    const second = await drainQueue(ctxWith(client))
    emEspera.resolve()

    expect(second).toEqual({ sent: 0, failed: 0 })
    await expect(first).resolves.toEqual({ sent: 1, failed: 0 })
  })
})

describe('drainQueue — envio', () => {
  it('envia as pendentes, remove da fila e avisa o renderer', async () => {
    const client = fakeClient()
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-2',
      type: 'worklog',
      payload: { summary: 'w', timeSpent: '1h', comment: null }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 2, failed: 0 })
    expect(listActions(db, 1)).toEqual([])
    expect(pushed).toEqual([{ channel: 'push:queue-changed', payload: { pending: 0, failed: 0 } }])
  })

  it('respeita a ordem de criação dentro do mesmo card', async () => {
    const client = fakeClient()
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'primeiro', body: 'um' }
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'segundo', body: 'dois' }
    })

    await drainQueue(ctxWith(client))

    const bodies = client.addComment.mock.calls.map((c) => JSON.stringify(c[1]))
    expect(bodies[0]).toContain('um')
    expect(bodies[1]).toContain('dois')
  })

  it('ações que ficaram inflight de um drain interrompido voltam para a fila e são enviadas', async () => {
    const client = fakeClient()
    const orphan = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })
    db.prepare(`UPDATE pending_action SET status = 'inflight' WHERE id = ?`).run(orphan.id)

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 1, failed: 0 })
    expect(client.addComment).toHaveBeenCalledTimes(1)
    expect(listActions(db, 1)).toEqual([])
  })
})

describe('drainQueue — erro de rede (retryable)', () => {
  it('devolve a ação para a fila com o erro e aborta o drain por completo', async () => {
    const netErr = Object.assign(new TypeError('fetch failed'), { code: 'ENOTFOUND' })
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw netErr
      })
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-2',
      type: 'comment',
      payload: { summary: 'c2', body: 'y' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 0 })

    const rows = listActions(db, 1)
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending'])
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].last_error).toBe('fetch failed')
    // abortou antes do segundo card
    expect(client.addComment).toHaveBeenCalledTimes(1)
    expect(shownNotifications).toEqual([])
    expect(pushed).toHaveLength(1)
  })

  it('HTTP 503 do Jira também é retryable', async () => {
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw new JiraHttpError(503, 'Service Unavailable')
      })
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 0 })
    expect(listActions(db, 1)[0].status).toBe('pending')
  })
})

describe('drainQueue — erro definitivo', () => {
  it('conflito de transição: marca failed, desfaz o status local e notifica', async () => {
    insertIssue('BT-1')
    const client = fakeClient({ issueTransitions: vi.fn(async () => []) })
    enqueueAction(db, 1, { issueKey: 'BT-1', type: 'transition', payload: transitionPayload() })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 1 })

    const [action] = listActions(db, 1)
    expect(action.status).toBe('failed')
    expect(action.attempts).toBe(1)
    expect(action.last_error).toContain('Não há mais transição para "Em andamento"')

    const issue = db.prepare(`SELECT status, status_category FROM issue WHERE key = 'BT-1'`).get()
    expect(issue).toEqual({ status: 'A fazer', status_category: 'new' })

    expect(shownNotifications).toHaveLength(1)
    expect(shownNotifications[0].title).toBe('Jiraiya')
    expect(shownNotifications[0].body).toContain(
      'BT-1: "Mover para Em andamento" não pôde ser enviada'
    )
    expect(pushed[0].payload).toEqual({ pending: 0, failed: 1 })
  })

  it('card excluído no Jira: falha explicando, purga o card e notifica', async () => {
    insertIssue('BT-907')
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw new JiraHttpError(404, 'Jira respondeu 404')
      }),
      issueExists: vi.fn(async () => false)
    } as unknown as Partial<FakeClient>)
    enqueueAction(db, 1, {
      issueKey: 'BT-907',
      type: 'comment',
      payload: { summary: 'Comentar: "oi"', body: 'oi' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 1 })

    const [action] = listActions(db, 1)
    expect(action.status).toBe('failed')
    expect(action.last_error).toContain('BT-907 não existe mais no Jira')
    expect(db.prepare(`SELECT key FROM issue WHERE key = 'BT-907'`).get()).toBeUndefined()
    expect(shownNotifications[0].body).toContain('não existe mais no Jira')
  })

  it('404 com o card vivo mantém a mensagem crua do Jira e o cache', async () => {
    insertIssue('BT-1')
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw new JiraHttpError(404, 'Jira respondeu 404')
      }),
      issueExists: vi.fn(async () => true)
    } as unknown as Partial<FakeClient>)
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 1 })
    expect(listActions(db, 1)[0].last_error).toBe('Jira respondeu 404')
    expect(db.prepare(`SELECT key FROM issue WHERE key = 'BT-1'`).get()).toEqual({ key: 'BT-1' })
  })

  it('erro definitivo pula as demais ações do mesmo card, mas segue nos outros', async () => {
    const client = fakeClient({
      addComment: vi.fn(async (key: string) => {
        if (key === 'BT-1') throw new JiraHttpError(400, 'Comentário inválido')
      })
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c1', body: 'x' }
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c2', body: 'y' }
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-2',
      type: 'comment',
      payload: { summary: 'c3', body: 'z' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 1, failed: 1 })

    const rows = listActions(db, 1)
    expect(rows.map((r) => [r.issue_key, r.status])).toEqual([
      ['BT-1', 'failed'],
      ['BT-1', 'pending']
    ])
    expect(shownNotifications).toHaveLength(1)
  })

  it('erro não-Error vira mensagem genérica', async () => {
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw 'string solta'
      })
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    await expect(drainQueue(ctxWith(client))).resolves.toEqual({ sent: 0, failed: 1 })
    expect(listActions(db, 1)[0].last_error).toBe('string solta')
  })

  it('rejeição sem mensagem legível cai em "Erro inesperado"', async () => {
    const client = fakeClient({
      addComment: vi.fn(async () => {
        throw { qualquer: 'coisa' }
      })
    })
    enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'x' }
    })

    await drainQueue(ctxWith(client))

    expect(listActions(db, 1)[0].last_error).toBe('Erro inesperado')
  })
})
