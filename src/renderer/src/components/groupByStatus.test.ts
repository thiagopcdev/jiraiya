import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/domain'
import { groupByStatus } from './groupByStatus'

function issue(
  key: string,
  status: string | null,
  category: string | null = 'indeterminate'
): Issue {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: null,
    issueType: 'Task',
    status,
    statusCategory: category as Issue['statusCategory'],
    priority: null,
    assigneeAccountId: null,
    assigneeName: null,
    reporterAccountId: null,
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: null,
    updatedAt: null,
    resolvedAt: null,
    url: `https://x/browse/${key}`
  }
}

describe('groupByStatus', () => {
  it('agrupa por status preservando a ordem de chegada (mais recente primeiro)', () => {
    const groups = groupByStatus([
      issue('BT-1', 'Pronto para teste'),
      issue('BT-2', 'Em andamento'),
      issue('BT-3', 'Pronto para teste'),
      issue('BT-4', 'Em teste'),
      issue('BT-5', 'Em andamento')
    ])
    expect(groups.map((g) => [g.status, g.issues.length])).toEqual([
      ['Pronto para teste', 2],
      ['Em andamento', 2],
      ['Em teste', 1]
    ])
    expect(groups[0].issues.map((i) => i.key)).toEqual(['BT-1', 'BT-3'])
  })

  it('status nulo vira "Sem status"', () => {
    const groups = groupByStatus([issue('BT-9', null)])
    expect(groups[0].status).toBe('Sem status')
  })

  it('lista vazia retorna vazio', () => {
    expect(groupByStatus([])).toEqual([])
  })
})
