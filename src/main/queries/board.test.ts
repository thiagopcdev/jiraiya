import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { Board, Issue } from '@shared/domain'
import { runMigrations } from '../db/migrations'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import {
  fallbackColumns,
  groupIssuesIntoColumns,
  isBacklogColumn,
  isReadOnlySprint,
  listBoardScopeIssues,
  pickTransition,
  resolveColumns,
  type BoardTransition,
  type ResolvedColumn
} from './board'

const iso = (d: string): string => new Date(d).toISOString()
const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString()

function baseIssue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: 'desc',
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: 'acc-someone',
    assigneeName: 'Alguém',
    reporterAccountId: 'acc-other',
    reporterName: null,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-07-01T09:00:00Z'),
    updatedAt: iso('2026-07-16T10:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

// Issue "solta" (não vem do DB) usada nos testes puros de resolveColumns/groupIssuesIntoColumns.
function fakeIssue(over: Partial<Issue>): Issue {
  return {
    jiraId: '1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'x',
    descriptionText: null,
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: null,
    assigneeAccountId: null,
    assigneeName: null,
    reporterAccountId: null,
    reporterName: null,
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: null,
    updatedAt: null,
    resolvedAt: null,
    url: 'https://x.atlassian.net/browse/BT-1',
    ...over
  }
}

describe('resolveColumns', () => {
  it('resolve nomes na ordem dos statusIds da coluna', () => {
    const config = {
      columns: [{ name: 'Em teste', statusIds: ['10004', '10005'], wipMax: null }]
    }
    const statuses: Array<{
      id: string
      name: string
      categoryKey: 'new' | 'indeterminate' | 'done'
    }> = [
      { id: '10005', name: 'Homologando', categoryKey: 'indeterminate' },
      { id: '10004', name: 'Em teste', categoryKey: 'indeterminate' }
    ]
    const resolved = resolveColumns(config, statuses)
    expect(resolved).toEqual([
      {
        name: 'Em teste',
        statusIds: ['10004', '10005'],
        statusNames: ['Em teste', 'Homologando'],
        wipMax: null
      }
    ])
  })

  it('id sem match no catálogo é omitido de statusNames, mas a coluna permanece', () => {
    const config = { columns: [{ name: 'Feito', statusIds: ['1', '999'], wipMax: null }] }
    const statuses: Array<{
      id: string
      name: string
      categoryKey: 'new' | 'indeterminate' | 'done'
    }> = [{ id: '1', name: 'Concluído', categoryKey: 'done' }]
    const resolved = resolveColumns(config, statuses)
    expect(resolved).toEqual([
      { name: 'Feito', statusIds: ['1', '999'], statusNames: ['Concluído'], wipMax: null }
    ])
  })

  it('múltiplas colunas', () => {
    const config = {
      columns: [
        { name: 'A fazer', statusIds: ['1'], wipMax: null },
        { name: 'Feito', statusIds: ['2'], wipMax: null }
      ]
    }
    const statuses: Array<{
      id: string
      name: string
      categoryKey: 'new' | 'indeterminate' | 'done'
    }> = [
      { id: '1', name: 'To Do', categoryKey: 'new' },
      { id: '2', name: 'Done', categoryKey: 'done' }
    ]
    const resolved = resolveColumns(config, statuses)
    expect(resolved.map((c) => c.name)).toEqual(['A fazer', 'Feito'])
    expect(resolved[0].statusNames).toEqual(['To Do'])
    expect(resolved[1].statusNames).toEqual(['Done'])
  })

  it('coluna com limite de WIP configurado -> wipMax repassado', () => {
    const config = {
      columns: [{ name: 'Em andamento', statusIds: ['1'], wipMax: 3 }]
    }
    const statuses: Array<{
      id: string
      name: string
      categoryKey: 'new' | 'indeterminate' | 'done'
    }> = [{ id: '1', name: 'Em andamento', categoryKey: 'indeterminate' }]
    const resolved = resolveColumns(config, statuses)
    expect(resolved[0].wipMax).toBe(3)
  })

  it('coluna sem limite configurado (caso comum) -> wipMax null', () => {
    const config = {
      columns: [{ name: 'A fazer', statusIds: ['1'], wipMax: null }]
    }
    const statuses: Array<{
      id: string
      name: string
      categoryKey: 'new' | 'indeterminate' | 'done'
    }> = [{ id: '1', name: 'A fazer', categoryKey: 'new' }]
    const resolved = resolveColumns(config, statuses)
    expect(resolved[0].wipMax).toBeNull()
  })
})

describe('isBacklogColumn', () => {
  it('kanban + 1ª coluna com nome de backlog → true (com e sem acento)', () => {
    expect(isBacklogColumn('kanban', 'Backlog', 0)).toBe(true)
    expect(isBacklogColumn('kanban', 'Lista de pendências', 0)).toBe(true)
    expect(isBacklogColumn('kanban', 'Lista de pendencias', 0)).toBe(true)
    expect(isBacklogColumn('kanban', '  BACKLOG  ', 0)).toBe(true)
  })

  it('fora da 1ª posição nunca é backlog', () => {
    expect(isBacklogColumn('kanban', 'Backlog', 1)).toBe(false)
  })

  it('scrum (ou tipo desconhecido) nunca marca', () => {
    expect(isBacklogColumn('scrum', 'Backlog', 0)).toBe(false)
    expect(isBacklogColumn(null, 'Backlog', 0)).toBe(false)
    expect(isBacklogColumn('simple', 'Backlog', 0)).toBe(false)
  })

  it('1ª coluna kanban com nome comum não marca', () => {
    expect(isBacklogColumn('kanban', 'A fazer', 0)).toBe(false)
  })
})

describe('groupIssuesIntoColumns', () => {
  const columns: ResolvedColumn[] = [
    { name: 'Fazendo', statusIds: ['1'], statusNames: ['Em andamento'], wipMax: null },
    {
      name: 'Aguardando Deploy',
      statusIds: ['2'],
      statusNames: ['AGUARDANDO DEPLOY HMG'],
      wipMax: null
    },
    { name: 'Impedimento', statusIds: ['3'], statusNames: ['IMPEDIMENTO'], wipMax: null }
  ]

  it('casa status por nome com normalização trim+lowercase', () => {
    const issues = [
      fakeIssue({ key: 'BT-1', status: '  em andamento  ' }),
      fakeIssue({ key: 'BT-2', status: 'aguardando deploy hmg' }),
      fakeIssue({ key: 'BT-3', status: 'Impedimento' })
    ]
    const { columns: grouped, unmapped } = groupIssuesIntoColumns(issues, columns)
    expect(grouped.find((c) => c.name === 'Fazendo')!.issues.map((i) => i.key)).toEqual(['BT-1'])
    expect(grouped.find((c) => c.name === 'Aguardando Deploy')!.issues.map((i) => i.key)).toEqual([
      'BT-2'
    ])
    expect(grouped.find((c) => c.name === 'Impedimento')!.issues.map((i) => i.key)).toEqual([
      'BT-3'
    ])
    expect(unmapped).toEqual([])
  })

  it('status que não está em nenhuma coluna -> unmapped', () => {
    const issues = [fakeIssue({ key: 'BT-9', status: 'Concluído' })]
    const { columns: grouped, unmapped } = groupIssuesIntoColumns(issues, columns)
    for (const c of grouped) expect(c.issues).toEqual([])
    expect(unmapped.map((i) => i.key)).toEqual(['BT-9'])
  })

  it('issue entra só na primeira coluna que casar', () => {
    const dupColumns: ResolvedColumn[] = [
      { name: 'Col A', statusIds: ['1'], statusNames: ['Em andamento'], wipMax: null },
      { name: 'Col B', statusIds: ['2'], statusNames: ['EM ANDAMENTO'], wipMax: null }
    ]
    const issues = [fakeIssue({ key: 'BT-1', status: 'Em Andamento' })]
    const { columns: grouped } = groupIssuesIntoColumns(issues, dupColumns)
    expect(grouped.find((c) => c.name === 'Col A')!.issues.map((i) => i.key)).toEqual(['BT-1'])
    expect(grouped.find((c) => c.name === 'Col B')!.issues.map((i) => i.key)).toEqual([])
  })

  it('status null nunca casa -> unmapped', () => {
    const issues = [fakeIssue({ key: 'BT-10', status: null })]
    const { unmapped } = groupIssuesIntoColumns(issues, columns)
    expect(unmapped.map((i) => i.key)).toEqual(['BT-10'])
  })
})

describe('pickTransition', () => {
  const t = (id: string, toStatusId: string): BoardTransition => ({
    id,
    name: `T${id}`,
    toStatusId,
    toStatusName: `Status ${toStatusId}`,
    toCategoryKey: 'indeterminate'
  })

  it('só há transição para o segundo alvo -> escolhe a de "20"', () => {
    const transitions = [t('99', '20')]
    const picked = pickTransition(transitions, ['10', '20'])
    expect(picked).toEqual(t('99', '20'))
  })

  it('há transições para os dois alvos -> escolhe a do primeiro ("10"), respeitando a ordem', () => {
    const transitions = [t('50', '20'), t('51', '10')]
    const picked = pickTransition(transitions, ['10', '20'])
    expect(picked).toEqual(t('51', '10'))
  })

  it('nenhuma transição bate -> null', () => {
    const transitions = [t('1', '999')]
    const picked = pickTransition(transitions, ['10', '20'])
    expect(picked).toBeNull()
  })
})

describe('isReadOnlySprint', () => {
  it('shown fechada diferente da ativa -> true', () => {
    expect(isReadOnlySprint({ jiraId: 1 }, { jiraId: 2 })).toBe(true)
  })

  it('shown === ativa -> false', () => {
    expect(isReadOnlySprint({ jiraId: 1 }, { jiraId: 1 })).toBe(false)
  })

  it('shown null -> false', () => {
    expect(isReadOnlySprint(null, { jiraId: 1 })).toBe(false)
  })

  it('shown existe e active null -> true', () => {
    expect(isReadOnlySprint({ jiraId: 1 }, null)).toBe(true)
  })
})

describe('listBoardScopeIssues', () => {
  let db: Database.Database
  const q = (): Parameters<typeof listBoardScopeIssues>[0] => ({
    db,
    workspaceId: 1,
    siteUrl: 'https://x.atlassian.net'
  })

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e', 'acc-me', 'now')`
    ).run()
  })

  describe('board scrum', () => {
    const scrumBoard: Board = { jiraId: 100, name: 'Board Scrum', type: 'scrum', projectKey: 'BT' }

    it('filtra por sprint_jira_id, qualquer assignee', () => {
      upsertIssue(
        db,
        1,
        baseIssue('BT-1', {
          sprintJiraId: 5,
          assigneeAccountId: 'acc-a',
          updatedAt: iso('2026-07-16T10:00:00Z')
        })
      )
      upsertIssue(
        db,
        1,
        baseIssue('BT-2', {
          sprintJiraId: 5,
          assigneeAccountId: 'acc-b',
          updatedAt: iso('2026-07-15T10:00:00Z')
        })
      )
      upsertIssue(db, 1, baseIssue('BT-3', { sprintJiraId: 6 })) // outra sprint -> fora
      const result = listBoardScopeIssues(q(), scrumBoard, 5)
      expect(result.map((i) => i.key)).toEqual(['BT-1', 'BT-2'])
    })

    it('sprintJiraId null -> []', () => {
      upsertIssue(db, 1, baseIssue('BT-1', { sprintJiraId: 5 }))
      const result = listBoardScopeIssues(q(), scrumBoard, null)
      expect(result).toEqual([])
    })

    it('sprint fechada: card com sprint_jira_id dela aparece; card que rolou para a nova sprint NÃO aparece na antiga (aproximação documentada)', () => {
      // BT-OLD ficou na sprint fechada (10)
      upsertIssue(db, 1, baseIssue('BT-OLD', { sprintJiraId: 10 }))
      // BT-ROLLED estava na sprint 10 originalmente, mas seu sprint_jira_id atual
      // aponta para a sprint nova (11) porque o card "rolou" — o cache só guarda a
      // última sprint associada, então ele deixa de aparecer ao consultar a sprint 10.
      upsertIssue(db, 1, baseIssue('BT-ROLLED', { sprintJiraId: 11 }))

      const closedSprintResult = listBoardScopeIssues(q(), scrumBoard, 10)
      expect(closedSprintResult.map((i) => i.key)).toEqual(['BT-OLD'])
      expect(closedSprintResult.map((i) => i.key)).not.toContain('BT-ROLLED')
    })

    it('ordena por updated_at DESC', () => {
      upsertIssue(
        db,
        1,
        baseIssue('BT-1', { sprintJiraId: 5, updatedAt: iso('2026-07-10T10:00:00Z') })
      )
      upsertIssue(
        db,
        1,
        baseIssue('BT-2', { sprintJiraId: 5, updatedAt: iso('2026-07-17T10:00:00Z') })
      )
      upsertIssue(
        db,
        1,
        baseIssue('BT-3', { sprintJiraId: 5, updatedAt: iso('2026-07-12T10:00:00Z') })
      )
      const result = listBoardScopeIssues(q(), scrumBoard, 5)
      expect(result.map((i) => i.key)).toEqual(['BT-2', 'BT-3', 'BT-1'])
    })
  })

  describe('board kanban (simple/kanban)', () => {
    const kanbanBoard: Board = {
      jiraId: 200,
      name: 'Board Kanban',
      type: 'simple',
      projectKey: 'BT'
    }

    it('filtra por project_key do board', () => {
      upsertIssue(db, 1, baseIssue('BT-1', { projectKey: 'BT' }))
      upsertIssue(db, 1, baseIssue('OTHER-1', { projectKey: 'OTHER' }))
      const result = listBoardScopeIssues(q(), kanbanBoard, null)
      expect(result.map((i) => i.key)).toEqual(['BT-1'])
    })

    it('inclui não-done e done recente (5 dias); exclui done antigo (30 dias)', () => {
      upsertIssue(
        db,
        1,
        baseIssue('BT-OPEN', { statusCategory: 'indeterminate', resolvedAt: null })
      )
      upsertIssue(
        db,
        1,
        baseIssue('BT-DONE-RECENT', {
          status: 'Concluído',
          statusCategory: 'done',
          resolvedAt: daysAgo(5)
        })
      )
      upsertIssue(
        db,
        1,
        baseIssue('BT-DONE-OLD', {
          status: 'Concluído',
          statusCategory: 'done',
          resolvedAt: daysAgo(30)
        })
      )
      const result = listBoardScopeIssues(q(), kanbanBoard, null)
      expect(result.map((i) => i.key).sort()).toEqual(['BT-DONE-RECENT', 'BT-OPEN'])
    })

    it('board type "kanban" (variante) se comporta igual a "simple"', () => {
      const kanbanBoard2: Board = {
        jiraId: 201,
        name: 'Board Kanban 2',
        type: 'kanban',
        projectKey: 'BT'
      }
      upsertIssue(db, 1, baseIssue('BT-1', { projectKey: 'BT' }))
      const result = listBoardScopeIssues(q(), kanbanBoard2, null)
      expect(result.map((i) => i.key)).toEqual(['BT-1'])
    })

    it('ordena por updated_at DESC', () => {
      upsertIssue(db, 1, baseIssue('BT-1', { updatedAt: iso('2026-07-10T10:00:00Z') }))
      upsertIssue(db, 1, baseIssue('BT-2', { updatedAt: iso('2026-07-17T10:00:00Z') }))
      upsertIssue(db, 1, baseIssue('BT-3', { updatedAt: iso('2026-07-12T10:00:00Z') }))
      const result = listBoardScopeIssues(q(), kanbanBoard, null)
      expect(result.map((i) => i.key)).toEqual(['BT-2', 'BT-3', 'BT-1'])
    })
  })
})

describe('fallbackColumns', () => {
  it('3 colunas por statusCategory; statusCategory null cai em "A fazer"; statusIds sempre []', () => {
    const issues = [
      fakeIssue({ key: 'BT-1', status: 'To Do', statusCategory: 'new' }),
      fakeIssue({ key: 'BT-2', status: 'Backlog', statusCategory: 'new' }),
      fakeIssue({ key: 'BT-3', status: 'Em andamento', statusCategory: 'indeterminate' }),
      fakeIssue({ key: 'BT-4', status: 'Concluído', statusCategory: 'done' }),
      fakeIssue({ key: 'BT-5', status: 'Sem categoria', statusCategory: null })
    ]
    const columns = fallbackColumns(issues)
    expect(columns.map((c) => c.name)).toEqual(['A fazer', 'Em andamento', 'Concluído'])
    for (const c of columns) expect(c.statusIds).toEqual([])

    const todo = columns.find((c) => c.name === 'A fazer')!
    expect(todo.statusNames.sort()).toEqual(['Backlog', 'Sem categoria', 'To Do'].sort())

    const doing = columns.find((c) => c.name === 'Em andamento')!
    expect(doing.statusNames).toEqual(['Em andamento'])

    const done = columns.find((c) => c.name === 'Concluído')!
    expect(done.statusNames).toEqual(['Concluído'])
  })
})
