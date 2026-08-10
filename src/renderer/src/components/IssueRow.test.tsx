// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Issue } from '@shared/domain'
import { IssueRow } from './IssueRow'
import { IssueDetailContext } from './issueDetail'
import { installMockApi } from '../testing/mockApi'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Ajustar layout do card',
    descriptionText: null,
    issueType: 'Story',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: null,
    assigneeName: null,
    reporterAccountId: null,
    reporterName: null,
    storyPoints: 5,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: null,
    updatedAt: null,
    resolvedAt: null,
    url: 'https://x.atlassian.net/browse/BT-1',
    ...overrides
  }
}

function renderRow(issue: Issue, openIssue = vi.fn()): { openIssue: typeof openIssue } {
  render(
    <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
      <IssueRow issue={issue} />
    </IssueDetailContext.Provider>
  )
  return { openIssue }
}

describe('IssueRow', () => {
  afterEach(() => cleanup())

  it('renderiza key, resumo, story points e badge de status', () => {
    installMockApi()
    renderRow(makeIssue())
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('Ajustar layout do card')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Em andamento')).toBeInTheDocument()
  })

  it('omite o badge de story points quando é null', () => {
    installMockApi()
    renderRow(makeIssue({ storyPoints: null }))
    expect(screen.queryByText('5')).not.toBeInTheDocument()
  })

  it('omite o badge de status quando status é null', () => {
    installMockApi()
    renderRow(makeIssue({ status: null, statusCategory: null }))
    expect(screen.queryByText('Em andamento')).not.toBeInTheDocument()
  })

  it('clicar na linha abre o card na gaveta', async () => {
    installMockApi()
    const user = userEvent.setup()
    const { openIssue } = renderRow(makeIssue())
    await user.click(screen.getByTitle('BT-1'))
    expect(openIssue).toHaveBeenCalledWith('BT-1')
  })

  it('clicar no ícone externo abre no Jira sem abrir a gaveta (stopPropagation)', async () => {
    const api = installMockApi({ 'shell:openIssue': () => ({ ok: true }) })
    const user = userEvent.setup()
    const { openIssue } = renderRow(makeIssue())
    await user.click(screen.getByTitle('Abrir BT-1 no Jira'))
    expect(api.count('shell:openIssue')).toBe(1)
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-1' })
    expect(openIssue).not.toHaveBeenCalled()
  })
})
