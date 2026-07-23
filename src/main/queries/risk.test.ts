import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/domain'
import { computeRiskSignals } from './risk'

function baseIssue(over: Partial<Issue> = {}): Issue {
  return {
    jiraId: 'BT-1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Issue de teste',
    descriptionText: 'desc',
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: 'acc-me',
    assigneeName: 'Eu',
    reporterAccountId: 'acc-other',
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
    resolvedAt: null,
    url: 'https://x.atlassian.net/browse/BT-1',
    ...over
  }
}

describe('computeRiskSignals', () => {
  it('card limpo → score 0, signals vazio', () => {
    const result = computeRiskSignals({
      issue: baseIssue(),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result).toEqual({ signals: [], score: 0 })
  })

  it('storyPoints null → "sem estimativa" isolado', () => {
    const result = computeRiskSignals({
      issue: baseIssue({ storyPoints: null }),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result.signals).toEqual(['sem estimativa'])
    expect(result.score).toBe(1)
  })

  it('rejections >= 1 → "reprovado Nx na sprint" isolado', () => {
    const result = computeRiskSignals({
      issue: baseIssue(),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 2,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result.signals).toEqual(['reprovado 2x na sprint'])
    expect(result.score).toBe(1)
  })

  it('daysSinceLastActivity >= stalledDays → "sem atividade há N dias" isolado', () => {
    const result = computeRiskSignals({
      issue: baseIssue(),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 7,
      stalledDays: 5
    })
    expect(result.signals).toEqual(['sem atividade há 7 dias'])
    expect(result.score).toBe(1)
  })

  it('daysInCurrentStatus >= 5 → "há N dias em {status}" isolado', () => {
    const result = computeRiskSignals({
      issue: baseIssue({ status: 'Em revisão' }),
      daysInCurrentStatus: 6,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result.signals).toEqual(['há 6 dias em Em revisão'])
    expect(result.score).toBe(1)
  })

  it('flagged → "sinalizado (impedimento)" isolado', () => {
    const result = computeRiskSignals({
      issue: baseIssue({ flagged: true }),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result.signals).toEqual(['sinalizado (impedimento)'])
    expect(result.score).toBe(1)
  })

  it('todos os sinais juntos → score 5', () => {
    const result = computeRiskSignals({
      issue: baseIssue({ storyPoints: null, status: 'Em revisão', flagged: true }),
      daysInCurrentStatus: 7,
      rejectionsInWindow: 2,
      daysSinceLastActivity: 10,
      stalledDays: 5
    })
    expect(result.score).toBe(5)
    expect(result.signals).toContain('sem estimativa')
    expect(result.signals).toContain('reprovado 2x na sprint')
    expect(result.signals).toContain('sem atividade há 10 dias')
    expect(result.signals).toContain('há 7 dias em Em revisão')
    expect(result.signals).toContain('sinalizado (impedimento)')
  })

  it('daysInCurrentStatus null → não dispara "há N dias em"', () => {
    const result = computeRiskSignals({
      issue: baseIssue(),
      daysInCurrentStatus: null,
      rejectionsInWindow: 0,
      daysSinceLastActivity: 0,
      stalledDays: 5
    })
    expect(result.signals).toEqual([])
    expect(result.score).toBe(0)
  })

  it('daysSinceLastActivity null → não dispara "sem atividade há"', () => {
    const result = computeRiskSignals({
      issue: baseIssue(),
      daysInCurrentStatus: 1,
      rejectionsInWindow: 0,
      daysSinceLastActivity: null,
      stalledDays: 5
    })
    expect(result.signals).toEqual([])
    expect(result.score).toBe(0)
  })
})
