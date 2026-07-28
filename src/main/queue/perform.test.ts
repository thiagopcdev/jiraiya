import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { AppContext } from '../appContext'
import type { JiraClient } from '../jira/client'
import { runMigrations } from '../db/migrations'
import { upsertIssue } from '../db/repos/issue'
import { getWorkspaceRow } from '../db/repos/workspace'
import { enqueueAction, type PendingActionRow } from './repo'
import { buildJiraUpdateFields, performAction, revertAction, storyPointsFieldIdOf } from './perform'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

type WorkspaceRow = NonNullable<ReturnType<typeof getWorkspaceRow>>

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
      {
        id: '31',
        name: 'Em andamento',
        toStatusName: 'Em andamento',
        toCategoryKey: 'indeterminate'
      }
    ]),
    doTransition: vi.fn(async () => undefined),
    addWorklog: vi.fn(async () => undefined),
    updateIssue: vi.fn(async () => undefined),
    ...over
  }
}

function ctxWith(db: Database.Database, client: FakeClient | null): AppContext {
  return { db, getClient: () => client as unknown as JiraClient | null } as unknown as AppContext
}

function insertIssue(db: Database.Database, key: string): void {
  upsertIssue(db, 1, {
    jiraId: '1000',
    key,
    projectKey: 'BT',
    summary: 'Card de teste',
    descriptionText: null,
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: 'High',
    assigneeAccountId: 'acc-1',
    assigneeName: 'Eu',
    reporterAccountId: 'acc-1',
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

function issueRow(db: Database.Database, key: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM issue WHERE workspace_id = 1 AND key = ?').get(key) as Record<
    string,
    unknown
  >
}

let db: Database.Database
let workspace: WorkspaceRow

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, story_points_field_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'customfield_10016', 'now')`
  ).run()
  workspace = getWorkspaceRow(db) as WorkspaceRow
})

describe('storyPointsFieldIdOf', () => {
  it('devolve o id configurado', () => {
    expect(storyPointsFieldIdOf(workspace)).toBe('customfield_10016')
  })

  it("'none' significa desativado → null", () => {
    expect(storyPointsFieldIdOf({ ...workspace, story_points_field_id: 'none' })).toBeNull()
  })

  it('null/vazio → null', () => {
    expect(storyPointsFieldIdOf({ ...workspace, story_points_field_id: null })).toBeNull()
    expect(storyPointsFieldIdOf({ ...workspace, story_points_field_id: '' })).toBeNull()
  })
})

describe('buildJiraUpdateFields', () => {
  it('story points só entram com o campo configurado', () => {
    expect(buildJiraUpdateFields({ storyPoints: 3 }, 'customfield_10016')).toEqual({
      customfield_10016: 3
    })
    expect(buildJiraUpdateFields({ storyPoints: 3 }, null)).toEqual({})
  })

  it('storyPoints null limpa o campo (é diferente de ausente)', () => {
    expect(buildJiraUpdateFields({ storyPoints: null }, 'cf')).toEqual({ cf: null })
    expect(buildJiraUpdateFields({}, 'cf')).toEqual({})
  })

  it('prioridade, severidade e estimativa viram o shape do Jira', () => {
    expect(
      buildJiraUpdateFields(
        {
          priorityId: '2',
          severity: { fieldId: 'customfield_1', optionId: '9' },
          originalEstimate: '2h'
        },
        null
      )
    ).toEqual({
      priority: { id: '2' },
      customfield_1: { id: '9' },
      timetracking: { originalEstimate: '2h' }
    })
  })

  it('assignee: id quando informado, null quando desatribuído, ausente quando não pedido', () => {
    expect(buildJiraUpdateFields({ assigneeAccountId: 'acc-9' }, null)).toEqual({
      assignee: { id: 'acc-9' }
    })
    expect(buildJiraUpdateFields({ assigneeAccountId: null }, null)).toEqual({ assignee: null })
    expect(buildJiraUpdateFields({ assigneeName: 'Fulano' }, null)).toEqual({})
  })
})

describe('performAction', () => {
  function row(
    type: PendingActionRow['type'],
    payload: Record<string, unknown>,
    issueKey = 'BT-1'
  ): PendingActionRow {
    return enqueueAction(db, 1, { issueKey, type, payload })
  }

  it('sem client conectado lança NOT_CONNECTED', async () => {
    const action = row('comment', { summary: 'c', body: 'oi' })

    await expect(performAction(ctxWith(db, null), workspace, action)).rejects.toThrow(
      'Nenhuma conta Jira conectada'
    )
  })

  it('payload corrompido lança QUEUE_PAYLOAD', async () => {
    const action = row('comment', { summary: 'c', body: 'oi' })
    db.prepare('UPDATE pending_action SET payload = ? WHERE id = ?').run('{quebrado', action.id)
    const corrupted = db
      .prepare('SELECT * FROM pending_action WHERE id = ?')
      .get(action.id) as PendingActionRow

    await expect(performAction(ctxWith(db, fakeClient()), workspace, corrupted)).rejects.toThrow(
      'Ação enfileirada com dados corrompidos'
    )
  })

  it('comment converte o markdown guardado para ADF só no envio', async () => {
    const client = fakeClient()
    const action = row('comment', { summary: 'Comentar', body: '**negrito**' })

    await performAction(ctxWith(db, client), workspace, action)

    expect(client.addComment).toHaveBeenCalledTimes(1)
    const [key, adf] = client.addComment.mock.calls[0]
    expect(key).toBe('BT-1')
    expect(JSON.stringify(adf)).toContain('strong')
  })

  it('transition acha a transição pelo id guardado', async () => {
    const client = fakeClient()
    const action = row('transition', {
      summary: 'Mover',
      transitionId: '31',
      toStatusName: 'Em andamento',
      toCategoryKey: 'indeterminate',
      revert: { status: 'A fazer', category: 'new' }
    })

    await performAction(ctxWith(db, client), workspace, action)

    expect(client.doTransition).toHaveBeenCalledWith('BT-1', '31')
  })

  it('transition com id sumido cai no plano B: mesma transição pelo nome do destino', async () => {
    const client = fakeClient({
      issueTransitions: vi.fn(async () => [
        { id: '99', name: 'Iniciar', toStatusName: 'EM ANDAMENTO', toCategoryKey: 'indeterminate' }
      ])
    })
    const action = row('transition', {
      summary: 'Mover',
      transitionId: '31',
      toStatusName: 'Em andamento',
      toCategoryKey: 'indeterminate',
      revert: { status: 'A fazer', category: 'new' }
    })

    await performAction(ctxWith(db, client), workspace, action)

    expect(client.doTransition).toHaveBeenCalledWith('BT-1', '99')
  })

  it('sem transição possível lança TRANSITION_CONFLICT citando o card', async () => {
    const client = fakeClient({ issueTransitions: vi.fn(async () => []) })
    const action = row('transition', {
      summary: 'Mover',
      transitionId: '31',
      toStatusName: 'Concluído',
      toCategoryKey: 'done',
      revert: { status: 'A fazer', category: 'new' }
    })

    await expect(performAction(ctxWith(db, client), workspace, action)).rejects.toThrow(
      'Não há mais transição para "Concluído" em BT-1 — o card mudou de estado no Jira'
    )
    expect(client.doTransition).not.toHaveBeenCalled()
  })

  it('worklog com comentário manda o texto como ADF', async () => {
    const client = fakeClient()
    const action = row('worklog', { summary: 'Apontar', timeSpent: '1h', comment: '  revisão  ' })

    await performAction(ctxWith(db, client), workspace, action)

    const [key, timeSpent, adf] = client.addWorklog.mock.calls[0]
    expect([key, timeSpent]).toEqual(['BT-1', '1h'])
    expect(JSON.stringify(adf)).toContain('revisão')
  })

  it('worklog sem comentário (null ou só espaços) manda undefined', async () => {
    const client = fakeClient()
    await performAction(
      ctxWith(db, client),
      workspace,
      row('worklog', { timeSpent: '30m', comment: null })
    )
    await performAction(
      ctxWith(db, client),
      workspace,
      row('worklog', { timeSpent: '30m', comment: '   ' })
    )

    expect(client.addWorklog.mock.calls[0][2]).toBeUndefined()
    expect(client.addWorklog.mock.calls[1][2]).toBeUndefined()
  })

  it('update envia os campos montados', async () => {
    const client = fakeClient()
    const action = row('update', {
      summary: 'Editar',
      fields: { storyPoints: 8, priorityId: '1' },
      revert: { storyPoints: 5 }
    })

    await performAction(ctxWith(db, client), workspace, action)

    expect(client.updateIssue).toHaveBeenCalledWith('BT-1', {
      customfield_10016: 8,
      priority: { id: '1' }
    })
  })

  it('update sem nenhum campo efetivo não chama o Jira', async () => {
    const client = fakeClient()
    const action = row('update', { summary: 'Editar', fields: {}, revert: {} })

    await performAction(ctxWith(db, client), workspace, action)

    expect(client.updateIssue).not.toHaveBeenCalled()
  })
})

describe('revertAction', () => {
  beforeEach(() => {
    insertIssue(db, 'BT-1')
  })

  it('transition volta status e categoria do cache local', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'transition',
      payload: {
        summary: 'Mover',
        transitionId: '31',
        toStatusName: 'Concluído',
        revert: { status: 'A fazer', category: 'new' }
      }
    })

    revertAction(ctxWith(db, null), 1, action)

    expect(issueRow(db, 'BT-1')).toMatchObject({ status: 'A fazer', status_category: 'new' })
  })

  it('transition sem revert completo não mexe no cache', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'transition',
      payload: { summary: 'Mover', revert: { status: null, category: null } }
    })

    revertAction(ctxWith(db, null), 1, action)

    expect(issueRow(db, 'BT-1')).toMatchObject({ status: 'Em andamento' })
  })

  it('transition sem chave revert no payload é tolerado', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'transition',
      payload: { summary: 'Mover' }
    })

    expect(() => revertAction(ctxWith(db, null), 1, action)).not.toThrow()
    expect(issueRow(db, 'BT-1')).toMatchObject({ status: 'Em andamento' })
  })

  it('update devolve story points, prioridade e responsável anteriores', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'update',
      payload: {
        summary: 'Editar',
        fields: { storyPoints: 13, assigneeAccountId: 'acc-9' },
        revert: {
          storyPoints: 5,
          priorityName: 'High',
          assigneeAccountId: 'acc-1',
          assigneeName: 'Eu'
        }
      }
    })
    db.prepare(
      `UPDATE issue SET story_points = 13, assignee_account_id = 'acc-9', assignee_name = 'Outro'
       WHERE workspace_id = 1 AND key = 'BT-1'`
    ).run()

    revertAction(ctxWith(db, null), 1, action)

    expect(issueRow(db, 'BT-1')).toMatchObject({
      story_points: 5,
      priority: 'High',
      assignee_account_id: 'acc-1',
      assignee_name: 'Eu'
    })
  })

  it('update com priorityName null não sobrescreve a prioridade', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'update',
      payload: { summary: 'Editar', fields: {}, revert: { priorityName: null, storyPoints: 1 } }
    })

    revertAction(ctxWith(db, null), 1, action)

    expect(issueRow(db, 'BT-1')).toMatchObject({ priority: 'High', story_points: 1 })
  })

  it('update sem revert é no-op', () => {
    const action = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'update',
      payload: { summary: 'Editar', fields: {} }
    })

    expect(() => revertAction(ctxWith(db, null), 1, action)).not.toThrow()
    expect(issueRow(db, 'BT-1')).toMatchObject({ story_points: 5 })
  })

  it('comentário e apontamento não têm efeito local a desfazer', () => {
    const comment = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'comment',
      payload: { summary: 'c', body: 'oi' }
    })
    const worklog = enqueueAction(db, 1, {
      issueKey: 'BT-1',
      type: 'worklog',
      payload: { summary: 'w', timeSpent: '1h', comment: null }
    })

    revertAction(ctxWith(db, null), 1, comment)
    revertAction(ctxWith(db, null), 1, worklog)

    expect(issueRow(db, 'BT-1')).toMatchObject({
      status: 'Em andamento',
      story_points: 5,
      assignee_account_id: 'acc-1'
    })
  })
})
