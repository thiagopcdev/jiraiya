// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Issue } from '@shared/domain'
import { IssuesByStatus } from './IssuesByStatus'
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
    storyPoints: null,
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

describe('IssuesByStatus', () => {
  afterEach(() => cleanup())

  it('agrupa issues pelo status real, cada grupo com sua contagem', () => {
    installMockApi()
    const issues = [
      makeIssue({ key: 'BT-1', status: 'Pronto para teste' }),
      makeIssue({ key: 'BT-2', status: 'Pronto para teste' }),
      makeIssue({ key: 'BT-3', status: 'Em teste' })
    ]
    render(<IssuesByStatus issues={issues} />)
    expect(screen.getByText(/Pronto para teste/)).toBeInTheDocument()
    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.getByText(/Em teste/)).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('BT-2')).toBeInTheDocument()
    expect(screen.getByText('BT-3')).toBeInTheDocument()
  })

  it('mostra o badge de story points quando presente', () => {
    installMockApi()
    render(<IssuesByStatus issues={[makeIssue({ storyPoints: 8 })]} />)
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('lista vazia não renderiza nenhum grupo', () => {
    installMockApi()
    const { container } = render(<IssuesByStatus issues={[]} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('clicar numa issue abre a gaveta com a key certa', async () => {
    installMockApi()
    const openIssue = vi.fn()
    const user = userEvent.setup()
    render(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <IssuesByStatus issues={[makeIssue({ key: 'BT-42' })]} />
      </IssueDetailContext.Provider>
    )
    await user.click(screen.getByTitle('Abrir BT-42'))
    expect(openIssue).toHaveBeenCalledWith('BT-42')
  })

  it('clicar no link externo chama shell:openIssue sem abrir a gaveta', async () => {
    const api = installMockApi({ 'shell:openIssue': () => ({ ok: true }) })
    const openIssue = vi.fn()
    const user = userEvent.setup()
    render(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <IssuesByStatus issues={[makeIssue({ key: 'BT-42' })]} />
      </IssueDetailContext.Provider>
    )
    await user.click(screen.getByTitle('Abrir BT-42 no Jira'))
    expect(api.count('shell:openIssue')).toBe(1)
    expect(openIssue).not.toHaveBeenCalled()
  })
})
