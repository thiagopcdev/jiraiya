// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { Alert, Issue } from '@shared/domain'
import { installMockApi } from '../../testing/mockApi'
import { makeQueryClient, renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import Alerts from './Alerts'

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    ruleId: 'stalled',
    issueKey: 'BT-1',
    severity: 'warning',
    message: 'BT-1 parado há 5 dias',
    firstDetectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides
  }
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-2',
    projectKey: 'BT',
    summary: 'Card seguido',
    descriptionText: null,
    issueType: 'Story',
    status: 'A fazer',
    statusCategory: 'new',
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
    url: 'https://x.atlassian.net/browse/BT-2',
    ...overrides
  }
}

describe('Alerts', () => {
  afterEach(() => cleanup())

  it('mostra o spinner enquanto carrega alertas', () => {
    installMockApi({
      'alerts:list': () => new Promise(() => {}),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    expect(document.querySelectorAll('.animate-spin').length).toBeGreaterThan(0)
  })

  it('estado vazio quando não há alertas nem seguidos', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [] }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhum alerta ativo. Tudo em ordem.')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Você não segue nenhum card — use o olho na gaveta do card.')
    ).toBeInTheDocument()
  })

  it('agrupa alertas por severidade com contagem', async () => {
    installMockApi({
      'alerts:list': () => ({
        alerts: [
          makeAlert({ id: 1, severity: 'critical', message: 'crítico 1' }),
          makeAlert({ id: 2, severity: 'warning', message: 'atenção 1' }),
          makeAlert({ id: 3, severity: 'warning', message: 'atenção 2' })
        ]
      }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('crítico 1')).toBeInTheDocument())
    expect(screen.getByText('(1)', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Críticos')).toBeInTheDocument()
    expect(screen.getByText('Atenção')).toBeInTheDocument()
    expect(screen.getByText('atenção 1')).toBeInTheDocument()
    expect(screen.getByText('atenção 2')).toBeInTheDocument()
  })

  it('dispensa um alerta e reconsulta a lista', async () => {
    const api = installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ id: 7 })] }),
      'watch:list': () => ({ issues: [] }),
      'alerts:dismiss': () => ({ ok: true })
    })
    const user = userEvent.setup()
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('BT-1 parado há 5 dias')).toBeInTheDocument())

    await user.click(screen.getByTitle('Dispensar'))
    expect(api.lastPayload('alerts:dismiss')).toEqual({ id: 7 })
    await waitFor(() => expect(api.count('alerts:list')).toBe(2))
  })

  it('clicar no ícone externo do alerta chama shell:openIssue', async () => {
    const api = installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ issueKey: 'BT-9' })] }),
      'watch:list': () => ({ issues: [] }),
      'shell:openIssue': () => ({ ok: true })
    })
    const user = userEvent.setup()
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByTitle('Abrir BT-9 no Jira')).toBeInTheDocument())
    await user.click(screen.getByTitle('Abrir BT-9 no Jira'))
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-9' })
  })

  it('alerta sem issueKey desabilita abrir e não mostra o link externo', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ issueKey: null, message: 'sem card' })] }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('sem card')).toBeInTheDocument())
    expect(screen.getByText('sem card').closest('button')).toBeDisabled()
  })

  it('renderiza a lista de cards seguidos', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [] }),
      'watch:list': () => ({ issues: [makeIssue()] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Card seguido')).toBeInTheDocument())
  })

  it('clicar no alerta abre a gaveta com a issueKey', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ issueKey: 'BT-5', message: 'abrir esse' })] }),
      'watch:list': () => ({ issues: [] })
    })
    const openIssue = vi.fn()
    const user = userEvent.setup()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <Alerts />
        </IssueDetailContext.Provider>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('abrir esse')).toBeInTheDocument())
    await user.click(screen.getByText('abrir esse'))
    expect(openIssue).toHaveBeenCalledWith('BT-5')
  })
})
