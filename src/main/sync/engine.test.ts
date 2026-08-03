import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { JiraClient } from '../jira/client'
import type { JiraChangelogHistory, JiraComment, JiraIssue } from '../jira/types'
import { runMigrations } from '../db/migrations'
import { listBoards, setSelectedProjects, upsertBoards, upsertProjects } from '../db/repos/catalog'
import { getSyncCursor, setPrefs, setSyncState } from '../db/repos/misc'
import { getWorkspaceRow } from '../db/repos/workspace'
import { JiraHttpError } from '../jira/http'
import { runSync, type SyncDeps, type SyncProgress } from './engine'

vi.mock('electron', async () => (await import('../testing/electronMock')).createElectronMock())

type Workspace = SyncDeps['workspace']

/** Issue crua mínima, com os campos que o mapIssue lê. */
function rawIssue(over: Partial<JiraIssue> & { key: string; id: string }): JiraIssue {
  return {
    id: over.id,
    key: over.key,
    fields: {
      summary: `Card ${over.key}`,
      project: { key: 'BT' },
      issuetype: { name: 'Task' },
      status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } },
      assignee: null,
      reporter: { accountId: 'acc-2' },
      created: '2026-07-01T10:00:00.000Z',
      updated: '2026-07-02T10:00:00.000Z',
      ...(over.fields ?? {})
    }
  } as unknown as JiraIssue
}

function mentionComment(id: string, accountId: string): JiraComment {
  return {
    id,
    author: { accountId: 'acc-2', displayName: 'Colega' },
    created: '2026-07-02T11:00:00.000Z',
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: accountId, text: '@Eu' } },
            { type: 'text', text: ' dá uma olhada' }
          ]
        }
      ]
    }
  } as unknown as JiraComment
}

interface ClientOpts {
  pages?: JiraIssue[][]
  fields?: Array<Record<string, unknown>>
  changelogs?: Map<string, JiraChangelogHistory[]>
  commentsByKey?: Record<string, JiraComment[]>
  sprints?: Array<Record<string, unknown>>
  boards?: Array<Record<string, unknown>>
  issueChangelog?: (key: string) => Promise<JiraChangelogHistory[]>
  /** keys que o Jira não devolve mais (cards excluídos) */
  missingKeys?: string[]
  issueComments?: (key: string) => Promise<JiraComment[]>
}

interface FakeSyncClient {
  listFields: ReturnType<typeof vi.fn>
  searchAll: ReturnType<typeof vi.fn>
  bulkChangelogs: ReturnType<typeof vi.fn>
  issueChangelog: ReturnType<typeof vi.fn>
  issueComments: ReturnType<typeof vi.fn>
  listSprints: ReturnType<typeof vi.fn>
  listBoards: ReturnType<typeof vi.fn>
  missingIssueKeys: ReturnType<typeof vi.fn>
}

function makeClient(opts: ClientOpts = {}): {
  client: FakeSyncClient
  calls: { searchJql: string[]; searchFields: string[][] }
} {
  const calls = { searchJql: [] as string[], searchFields: [] as string[][] }
  const client: FakeSyncClient = {
    listFields: vi.fn(async () => opts.fields ?? []),
    searchAll: vi.fn(
      async (jql: string, fields: string[], onPage: (page: JiraIssue[]) => Promise<void>) => {
        calls.searchJql.push(jql)
        calls.searchFields.push(fields)
        for (const page of opts.pages ?? []) await onPage(page)
      }
    ),
    bulkChangelogs: vi.fn(async () => opts.changelogs ?? new Map()),
    issueChangelog: vi.fn(opts.issueChangelog ?? (async () => [])),
    issueComments: vi.fn(
      opts.issueComments ?? (async (key: string) => opts.commentsByKey?.[key] ?? [])
    ),
    listSprints: vi.fn(async () => opts.sprints ?? []),
    listBoards: vi.fn(async () => opts.boards ?? []),
    missingIssueKeys: vi.fn(async () => opts.missingKeys ?? [])
  }
  return { client, calls }
}

let db: Database.Database
let workspace: Workspace

function deps(client: unknown, over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    db,
    client: client as unknown as JiraClient,
    workspace,
    ...over
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, time_zone, story_points_field_id, sprint_field_id, flagged_field_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'America/Sao_Paulo', 'customfield_10016', 'customfield_10020', 'customfield_10021', 'now')`
  ).run()
  workspace = getWorkspaceRow(db) as unknown as Workspace
})

describe('runSync — descoberta do campo flagged', () => {
  it('workspace sem flagged_field_id descobre uma vez e persiste', async () => {
    db.prepare('UPDATE workspace SET flagged_field_id = NULL WHERE id = 1').run()
    workspace = getWorkspaceRow(db) as unknown as Workspace
    const { client } = makeClient({
      fields: [
        {
          id: 'customfield_10099',
          name: 'Flagged',
          custom: true,
          schema: {
            custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes'
          }
        }
      ]
    })

    await runSync(deps(client))

    expect(client.listFields).toHaveBeenCalledTimes(1)
    expect(getWorkspaceRow(db)?.flagged_field_id).toBe('customfield_10099')
  })

  it("campo ausente é gravado como 'none' e não vira fields da busca", async () => {
    db.prepare('UPDATE workspace SET flagged_field_id = NULL WHERE id = 1').run()
    workspace = getWorkspaceRow(db) as unknown as Workspace
    const { client, calls } = makeClient({ fields: [] })

    await runSync(deps(client))

    expect(getWorkspaceRow(db)?.flagged_field_id).toBe('none')
    expect(calls.searchFields[0]).toEqual(['customfield_10016', 'customfield_10020'])
  })

  it('workspace já descoberto não chama listFields', async () => {
    const { client } = makeClient()
    await runSync(deps(client))
    expect(client.listFields).not.toHaveBeenCalled()
  })
})

describe('runSync — fase de issues', () => {
  it('grava as issues das páginas, avança o cursor e devolve o total processado', async () => {
    const { client, calls } = makeClient({
      pages: [
        [rawIssue({ id: '1', key: 'BT-1' }), rawIssue({ id: '2', key: 'BT-2' })],
        [
          rawIssue({
            id: '3',
            key: 'BT-3',
            fields: { updated: '2026-07-05T08:00:00.000Z' } as JiraIssue['fields']
          })
        ]
      ]
    })

    const result = await runSync(deps(client))

    expect(result.issuesProcessed).toBe(3)
    expect(db.prepare('SELECT COUNT(*) AS n FROM issue').get()).toEqual({ n: 3 })
    expect(getSyncCursor(db, 1, 'issues')).toBe('2026-07-05T08:00:00.000Z')
    expect(calls.searchJql[0]).toContain('ORDER BY updated ASC')
  })

  it('primeiro sync usa backfill em dias; sync incremental usa o cursor', async () => {
    setPrefs(db, { backfillDays: 7, syncMode: 'personal' })
    const first = makeClient()
    await runSync(deps(first.client))
    expect(first.calls.searchJql[0]).toContain('updated >= -7d')

    setSyncState(db, 1, 'issues', { cursor: '2026-07-10T00:00:00.000Z' })
    const second = makeClient()
    await runSync(deps(second.client))
    expect(second.calls.searchJql[0]).toMatch(/updated >= "2026-07-\d\d/)
  })

  it('opts.full ignora o cursor e refaz o backfill', async () => {
    setSyncState(db, 1, 'issues', { cursor: '2026-07-10T00:00:00.000Z' })
    setPrefs(db, { backfillDays: 30 })
    const { client, calls } = makeClient()

    await runSync(deps(client), { full: true })

    expect(calls.searchJql[0]).toContain('updated >= -30d')
  })

  it("modo 'project' com projetos selecionados restringe o JQL", async () => {
    setPrefs(db, { syncMode: 'project' })
    db.prepare(
      `INSERT INTO project (workspace_id, jira_id, key, name, selected) VALUES (1, '10', 'BT', 'Biud', 1)`
    ).run()
    const { client, calls } = makeClient()

    await runSync(deps(client))

    expect(calls.searchJql[0]).toContain('project IN ("BT")')
  })

  it('reporta progresso das fases', async () => {
    const progress: SyncProgress[] = []
    const { client } = makeClient({ pages: [[rawIssue({ id: '1', key: 'BT-1' })]] })

    await runSync(deps(client, { onProgress: (p) => progress.push(p) }))

    expect(progress[0]).toEqual({ phase: 'issues', done: 0, total: null })
    expect(progress).toEqual(
      expect.arrayContaining([
        { phase: 'issues', done: 1, total: null },
        { phase: 'activities', done: 0, total: 1 },
        { phase: 'sprints', done: 0, total: null }
      ])
    )
  })

  it('atribuição nova a mim entra no onAfterSync (mas não no primeiro sync)', async () => {
    const mine = rawIssue({
      id: '1',
      key: 'BT-1',
      fields: {
        assignee: { accountId: 'acc-1', displayName: 'Eu' }
      } as unknown as JiraIssue['fields']
    })

    // primeiro sync: sem cursor → nada é considerado atribuição nova
    const first = makeClient({ pages: [[mine]] })
    let info = { assignedToMe: [] as Array<{ key: string }>, newMentions: [] as unknown[] }
    await runSync(deps(first.client, { onAfterSync: (i) => (info = i) }))
    expect(info.assignedToMe).toEqual([])

    // segunda rodada: card sai de outra pessoa para mim
    db.prepare(`UPDATE issue SET assignee_account_id = 'acc-9' WHERE key = 'BT-1'`).run()
    const second = makeClient({ pages: [[mine]] })
    await runSync(deps(second.client, { onAfterSync: (i) => (info = i) }))

    expect(info.assignedToMe).toEqual([{ key: 'BT-1', summary: 'Card BT-1' }])
  })
})

describe('runSync — fase de activities', () => {
  it('deriva activities do changelog do bulk e marca o changelog como sincronizado', async () => {
    const changelogs = new Map<string, JiraChangelogHistory[]>([
      [
        '1',
        [
          {
            id: '10',
            created: '2026-07-02T09:00:00.000Z',
            author: { accountId: 'acc-2', displayName: 'Colega' },
            items: [{ field: 'status', fromString: 'A fazer', toString: 'Em andamento' }]
          } as unknown as JiraChangelogHistory
        ]
      ]
    ])
    const { client } = makeClient({ pages: [[rawIssue({ id: '1', key: 'BT-1' })]], changelogs })

    const result = await runSync(deps(client))

    expect(result.activitiesIssues).toBe(1)
    const activities = db.prepare('SELECT kind, field FROM issue_activity').all() as Array<{
      kind: string
      field: string | null
    }>
    expect(activities.some((a) => a.field === 'status')).toBe(true)
    expect(
      db.prepare(`SELECT changelog_synced_at FROM issue WHERE key = 'BT-1'`).get()
    ).not.toEqual({ changelog_synced_at: null })
  })

  it('issue ausente do bulk e com mudanças cai no fallback por issue', async () => {
    const issueChangelog = vi.fn(async () => [
      {
        id: '11',
        created: '2026-07-02T09:30:00.000Z',
        author: { accountId: 'acc-2', displayName: 'Colega' },
        items: [{ field: 'status', fromString: 'A fazer', toString: 'Em andamento' }]
      } as unknown as JiraChangelogHistory
    ])
    const { client } = makeClient({
      pages: [[rawIssue({ id: '1', key: 'BT-1' })]],
      changelogs: new Map(),
      issueChangelog
    })

    await runSync(deps(client))

    expect(issueChangelog).toHaveBeenCalledWith('BT-1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM issue_activity').get()).not.toEqual({ n: 0 })
  })

  it('falha no fallback do changelog não derruba o sync', async () => {
    const { client } = makeClient({
      pages: [[rawIssue({ id: '1', key: 'BT-1' })]],
      changelogs: new Map(),
      issueChangelog: async () => {
        throw new Error('changelog gigante')
      }
    })

    await expect(runSync(deps(client))).resolves.toMatchObject({ activitiesIssues: 1 })
  })

  it('issue sem mudanças (updated == created) não busca changelog por issue', async () => {
    const issueChangelog = vi.fn(async () => [])
    const { client } = makeClient({
      pages: [
        [
          rawIssue({
            id: '1',
            key: 'BT-1',
            fields: {
              created: '2026-07-01T10:00:00.000Z',
              updated: '2026-07-01T10:00:00.000Z'
            } as unknown as JiraIssue['fields']
          })
        ]
      ],
      changelogs: new Map(),
      issueChangelog
    })

    await runSync(deps(client))

    expect(issueChangelog).not.toHaveBeenCalled()
  })

  it('comentários viram activities e menções a mim entram no onAfterSync', async () => {
    // primeiro sync marca as menções como lidas e não notifica
    const first = makeClient({
      pages: [[rawIssue({ id: '1', key: 'BT-1' })]],
      commentsByKey: { 'BT-1': [mentionComment('900', 'acc-1')] }
    })
    let info = { assignedToMe: [] as unknown[], newMentions: [] as Array<{ issueKey: string }> }
    await runSync(deps(first.client, { onAfterSync: (i) => (info = i) }))

    expect(info.newMentions).toEqual([])
    const mention = db.prepare('SELECT read_at FROM mention').get() as { read_at: string | null }
    expect(mention.read_at).not.toBeNull()

    // rodada seguinte, card atualizado de novo e menção nova em outro comentário
    const second = makeClient({
      pages: [
        [
          rawIssue({
            id: '1',
            key: 'BT-1',
            fields: { updated: '2026-07-20T10:00:00.000Z' } as unknown as JiraIssue['fields']
          })
        ]
      ],
      commentsByKey: { 'BT-1': [mentionComment('901', 'acc-1')] }
    })
    await runSync(deps(second.client, { onAfterSync: (i) => (info = i) }))

    expect(info.newMentions).toEqual([
      { issueKey: 'BT-1', authorName: 'Colega', excerpt: '@Eu dá uma olhada' }
    ])
  })

  it('auto-menção não entra em newMentions', async () => {
    const first = makeClient({ pages: [[rawIssue({ id: '1', key: 'BT-1' })]] })
    await runSync(deps(first.client))

    const second = makeClient({
      pages: [
        [
          rawIssue({
            id: '1',
            key: 'BT-1',
            fields: { updated: '2026-07-20T10:00:00.000Z' } as unknown as JiraIssue['fields']
          })
        ]
      ],
      commentsByKey: {
        'BT-1': [
          {
            ...mentionComment('902', 'acc-1'),
            author: { accountId: 'acc-1', displayName: 'Eu' }
          } as unknown as JiraComment
        ]
      }
    })
    let info = { assignedToMe: [] as unknown[], newMentions: [] as unknown[] }
    await runSync(deps(second.client, { onAfterSync: (i) => (info = i) }))

    expect(info.newMentions).toEqual([])
  })

  it('recupera pendências de rodadas anteriores (issue gravada sem activity derivada)', async () => {
    db.prepare(
      `INSERT INTO issue (workspace_id, jira_id, key, project_key, summary, labels_json, flagged, created_at, updated_at, changelog_synced_at, last_synced_at)
       VALUES (1, '77', 'BT-77', 'BT', 'Pendência antiga', '[]', 0, '2026-06-01T10:00:00.000Z', '2026-06-02T10:00:00.000Z', NULL, 'now')`
    ).run()
    const { client } = makeClient({ pages: [] })

    const result = await runSync(deps(client))

    expect(result.activitiesIssues).toBe(1)
    expect(client.issueComments).toHaveBeenCalledWith('BT-77')
  })

  it('progresso de activities é reportado a cada 10 e no fim', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      rawIssue({ id: String(i + 1), key: `BT-${i + 1}` })
    )
    const progress: SyncProgress[] = []
    const { client } = makeClient({ pages: [rows] })

    await runSync(deps(client, { onProgress: (p) => progress.push(p) }))

    const activities = progress.filter((p) => p.phase === 'activities').map((p) => p.done)
    expect(activities).toEqual([0, 10, 12])
  })
})

describe('runSync — fase de sprints', () => {
  it('busca sprints de cada board conhecido e grava normalizado', async () => {
    upsertBoards(db, 1, [{ jiraId: 5, name: 'Board BT', type: 'scrum', projectKey: 'BT' }])
    const { client } = makeClient({
      sprints: [
        {
          id: 100,
          name: 'Sprint 1',
          state: 'closed',
          startDate: '2026-06-01T00:00:00.000Z',
          endDate: '2026-06-15T00:00:00.000Z',
          completeDate: '2026-06-15T10:00:00.000Z'
        },
        { id: 101, name: 'Sprint 2', state: 'active', originBoardId: 9 }
      ]
    })

    await runSync(deps(client))

    expect(client.listSprints).toHaveBeenCalledWith(5)
    const sprints = db
      .prepare('SELECT jira_id, board_jira_id, state, start_date FROM sprint ORDER BY jira_id')
      .all()
    expect(sprints).toEqual([
      {
        jira_id: 100,
        board_jira_id: 5,
        state: 'closed',
        start_date: '2026-06-01T00:00:00.000Z'
      },
      { jira_id: 101, board_jira_id: 9, state: 'active', start_date: null }
    ])
  })

  it('sem boards conhecidos não busca sprint', async () => {
    const { client } = makeClient()
    await runSync(deps(client))
    expect(client.listSprints).not.toHaveBeenCalled()
  })
})

describe('runSync — refresh de boards dos projetos selecionados', () => {
  function selectProject(key: string): void {
    upsertProjects(db, 1, [{ jiraId: `id-${key}`, key, name: `Projeto ${key}`, avatarUrl: null }])
    setSelectedProjects(db, 1, [key])
  }

  it('quadro criado no Jira depois da configuração aparece no próximo sync', async () => {
    selectProject('BT')
    upsertBoards(db, 1, [{ jiraId: 5, name: 'Board BT', type: 'scrum', projectKey: 'BT' }])
    const { client } = makeClient({
      boards: [
        { id: 5, name: 'Board BT', type: 'scrum', location: { projectKey: 'BT' } },
        { id: 9, name: 'Board novo', type: 'kanban', location: { projectKey: 'BT' } }
      ]
    })

    await runSync(deps(client))

    expect(client.listBoards).toHaveBeenCalledWith('BT')
    expect(
      listBoards(db, 1)
        .map((b) => b.jiraId)
        .sort()
    ).toEqual([5, 9])
    // o board novo já entra na busca de sprints da mesma rodada
    expect(client.listSprints).toHaveBeenCalledWith(9)
  })

  it('quadro apagado no Jira some do cache local', async () => {
    selectProject('BT')
    upsertBoards(db, 1, [
      { jiraId: 5, name: 'Board BT', type: 'scrum', projectKey: 'BT' },
      { jiraId: 9, name: 'Board antigo', type: 'kanban', projectKey: 'BT' }
    ])
    const { client } = makeClient({
      boards: [{ id: 5, name: 'Board BT', type: 'scrum', location: { projectKey: 'BT' } }]
    })

    await runSync(deps(client))

    expect(listBoards(db, 1).map((b) => b.jiraId)).toEqual([5])
    expect(client.listSprints).not.toHaveBeenCalledWith(9)
  })

  it('falha ao listar boards mantém o cache local e não derruba o sync', async () => {
    selectProject('BT')
    upsertBoards(db, 1, [{ jiraId: 5, name: 'Board BT', type: 'scrum', projectKey: 'BT' }])
    const { client } = makeClient()
    client.listBoards.mockRejectedValue(new Error('Jira fora do ar'))

    await runSync(deps(client))

    expect(listBoards(db, 1).map((b) => b.jiraId)).toEqual([5])
    expect(client.listSprints).toHaveBeenCalledWith(5)
  })

  it('board de outro projeto não é removido pelo prune do selecionado', async () => {
    selectProject('BT')
    upsertBoards(db, 1, [
      { jiraId: 5, name: 'Board BT', type: 'scrum', projectKey: 'BT' },
      { jiraId: 7, name: 'Board XP', type: 'scrum', projectKey: 'XP' }
    ])
    const { client } = makeClient({
      boards: [{ id: 5, name: 'Board BT', type: 'scrum', location: { projectKey: 'BT' } }]
    })

    await runSync(deps(client))

    expect(
      listBoards(db, 1)
        .map((b) => b.jiraId)
        .sort()
    ).toEqual([5, 7])
  })
})

describe('runSync — estado do sync', () => {
  it('sucesso deixa status idle com last_success_at', async () => {
    const { client } = makeClient()
    await runSync(deps(client))

    const row = db
      .prepare(`SELECT status, error, last_success_at FROM sync_state WHERE resource = 'issues'`)
      .get() as { status: string; error: string | null; last_success_at: string | null }
    expect(row.status).toBe('idle')
    expect(row.error).toBeNull()
    expect(row.last_success_at).not.toBeNull()
  })

  it('erro grava status error com a mensagem e relança', async () => {
    const { client } = makeClient()
    client.searchAll.mockImplementation(async () => {
      throw new Error('Jira fora do ar')
    })

    await expect(runSync(deps(client))).rejects.toThrow('Jira fora do ar')

    const row = db
      .prepare(`SELECT status, error FROM sync_state WHERE resource = 'issues'`)
      .get() as { status: string; error: string | null }
    expect(row).toEqual({ status: 'error', error: 'Jira fora do ar' })
  })

  it('rejeição não-Error também é registrada', async () => {
    const { client } = makeClient()
    client.searchAll.mockImplementation(async () => {
      throw 'pane'
    })

    await expect(runSync(deps(client))).rejects.toBe('pane')
    expect(db.prepare(`SELECT error FROM sync_state WHERE resource = 'issues'`).get()).toEqual({
      error: 'pane'
    })
  })

  it('onAfterSync não é chamado quando o sync falha', async () => {
    const onAfterSync = vi.fn()
    const { client } = makeClient()
    client.searchAll.mockImplementation(async () => {
      throw new Error('falhou')
    })

    await expect(runSync(deps(client, { onAfterSync }))).rejects.toThrow()
    expect(onAfterSync).not.toHaveBeenCalled()
  })
})

describe('runSync — cards excluídos no Jira', () => {
  /** grava um card em cache já com o changelog em dia (não entra na fase 2) */
  const seedSynced = (key: string): void => {
    db.prepare(
      `INSERT INTO issue (workspace_id, jira_id, key, project_key, summary, updated_at, created_at, changelog_synced_at)
       VALUES (1, ?, ?, 'BT', ?, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`
    ).run(key, key, `Card ${key}`)
  }

  const keysInCache = (): string[] =>
    (db.prepare('SELECT key FROM issue ORDER BY key').all() as Array<{ key: string }>).map(
      (r) => r.key
    )

  it('sync completo remove do cache os cards que o Jira não devolve mais', async () => {
    seedSynced('BT-907')
    seedSynced('BT-908')
    const { client } = makeClient({ missingKeys: ['BT-907'] })

    const res = await runSync(deps(client), { full: true })

    expect(client.missingIssueKeys).toHaveBeenCalledWith(['BT-907', 'BT-908'])
    expect(keysInCache()).toEqual(['BT-908'])
    expect(res.purgedIssues).toEqual(['BT-907'])
  })

  it('sync incremental não paga o custo da reconciliação', async () => {
    seedSynced('BT-907')
    const { client } = makeClient({ missingKeys: ['BT-907'] })

    const res = await runSync(deps(client))

    expect(client.missingIssueKeys).not.toHaveBeenCalled()
    expect(keysInCache()).toEqual(['BT-907'])
    expect(res.purgedIssues).toEqual([])
  })

  it('falha na reconciliação não derruba o sync', async () => {
    seedSynced('BT-907')
    const { client } = makeClient()
    client.missingIssueKeys.mockImplementation(async () => {
      throw new Error('bulkfetch fora do ar')
    })

    const res = await runSync(deps(client), { full: true })

    expect(res.purgedIssues).toEqual([])
    expect(keysInCache()).toEqual(['BT-907'])
  })

  it('cache vazio não chama o Jira', async () => {
    const { client } = makeClient()
    await runSync(deps(client), { full: true })
    expect(client.missingIssueKeys).not.toHaveBeenCalled()
  })

  it('404 nos comentários (card apagado no meio do sync) purga e segue', async () => {
    const { client } = makeClient({
      pages: [[rawIssue({ id: '1', key: 'BT-907' }), rawIssue({ id: '2', key: 'BT-908' })]],
      issueComments: async (key: string) => {
        if (key === 'BT-907') throw new JiraHttpError(404, 'Jira respondeu 404')
        return []
      }
    })

    const res = await runSync(deps(client))

    expect(keysInCache()).toEqual(['BT-908'])
    expect(res.purgedIssues).toEqual(['BT-907'])
    expect(res.activitiesIssues).toBe(1)
  })

  it('erro que não é 404 nos comentários ainda derruba o sync', async () => {
    const { client } = makeClient({
      pages: [[rawIssue({ id: '1', key: 'BT-907' })]],
      issueComments: async () => {
        throw new JiraHttpError(400, 'Jira respondeu 400')
      }
    })

    await expect(runSync(deps(client))).rejects.toThrow('400')
    expect(keysInCache()).toEqual(['BT-907'])
  })
})
