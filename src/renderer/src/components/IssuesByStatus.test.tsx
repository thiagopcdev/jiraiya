// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  describe('variant="primary" (painel "Em andamento" da Hoje)', () => {
    beforeEach(() => localStorage.clear())

    it('rótulo do grupo em azul, badge "sem sp" e idade além do stalledDays em âmbar', () => {
      installMockApi()
      const oldDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()
      render(
        <IssuesByStatus
          issues={[
            makeIssue({
              key: 'BT-900',
              status: 'Em desenvolvimento',
              updatedAt: oldDate,
              storyPoints: null
            })
          ]}
          variant="primary"
          stalledDays={3}
        />
      )
      const header = screen.getByText('Em desenvolvimento')
      expect(header.className).toContain('text-blue-300')
      expect(screen.getByText('sem sp')).toBeInTheDocument()
      const age = screen.getByText(/^há /)
      expect(age.className).toContain('text-amber-400')
    })

    it('idade dentro do stalledDays não fica em âmbar', () => {
      installMockApi()
      const recentDate = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString()
      render(
        <IssuesByStatus
          issues={[makeIssue({ key: 'BT-901', updatedAt: recentDate })]}
          variant="primary"
          stalledDays={3}
        />
      )
      const age = screen.getByText(/^há /)
      expect(age.className).not.toContain('text-amber-400')
    })

    it('botão de timer inicia e pausa o card (lib/timer.ts, sem TimerControl)', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <IssuesByStatus issues={[makeIssue({ key: 'BT-902' })]} variant="primary" stalledDays={3} />
      )
      const startButton = screen.getByRole('button', { name: /iniciar/ })
      await user.click(startButton)
      // rodando: o botão troca o rótulo "iniciar" pelo cronômetro (formatTimer)
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /iniciar/ })).not.toBeInTheDocument()
      )
      const runningButton = screen.getByText(/^\d+:\d{2}$/).closest('button')
      expect(runningButton).not.toBeNull()
      await user.click(runningButton!)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /iniciar/ })).toBeInTheDocument()
      )
    })

    it('clicar na issue abre a gaveta (não confunde com o clique no timer)', async () => {
      const openIssue = vi.fn()
      const user = userEvent.setup()
      render(
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <IssuesByStatus
            issues={[makeIssue({ key: 'BT-903' })]}
            variant="primary"
            stalledDays={3}
          />
        </IssueDetailContext.Provider>
      )
      await user.click(screen.getByTitle('Abrir BT-903'))
      expect(openIssue).toHaveBeenCalledWith('BT-903')
    })
  })
})
