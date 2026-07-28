// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { IssueActivity, Project } from '@shared/domain'
import { installMockApi } from '../../testing/mockApi'
import { makeQueryClient, renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import Timeline from './Timeline'

function makeActivity(overrides: Partial<IssueActivity> = {}): IssueActivity {
  return {
    id: 1,
    issueKey: 'BT-1',
    issueSummary: 'Ajustar layout',
    issueStatus: 'Em andamento',
    kind: 'status_change',
    actorAccountId: 'acc-1',
    actorName: 'Fulano',
    field: 'status',
    fromValue: 'A fazer',
    toValue: 'Em andamento',
    bodyText: null,
    occurredAt: new Date().toISOString(),
    ...overrides
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    jiraId: '1',
    key: 'BT',
    name: 'Board Time',
    avatarUrl: null,
    selected: true,
    ...overrides
  }
}

describe('Timeline', () => {
  afterEach(() => cleanup())

  it('mostra o spinner enquanto carrega', () => {
    installMockApi({
      'activity:timeline': () => new Promise(() => {}),
      'projects:list': () => ({ projects: [] })
    })
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('estado vazio quando não há atividade no período', async () => {
    installMockApi({
      'activity:timeline': () => ({ activities: [] }),
      'projects:list': () => ({ projects: [] })
    })
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhuma atividade no período selecionado.')).toBeInTheDocument()
    )
  })

  it('agrupa atividades por dia e mostra a mudança de status', async () => {
    installMockApi({
      'activity:timeline': () => ({ activities: [makeActivity()] }),
      'projects:list': () => ({ projects: [] })
    })
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ajustar layout')).toBeInTheDocument())
    expect(screen.getAllByText('Hoje').length).toBeGreaterThan(0)
    expect(screen.getByText('moveu')).toBeInTheDocument()
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === 'A fazer → Em andamento')
    ).toBeInTheDocument()
  })

  it('atividade de comentário mostra o trecho do corpo', async () => {
    installMockApi({
      'activity:timeline': () => ({
        activities: [
          makeActivity({
            kind: 'comment',
            bodyText: 'ficou pronto',
            fromValue: null,
            toValue: null
          })
        ]
      }),
      'projects:list': () => ({ projects: [] })
    })
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('comentou')).toBeInTheDocument())
    expect(screen.getByText('ficou pronto')).toBeInTheDocument()
  })

  it('desmarcar "somente minhas ações" mostra o autor da atividade', async () => {
    installMockApi({
      'activity:timeline': () => ({ activities: [makeActivity({ actorName: 'Fulano' })] }),
      'projects:list': () => ({ projects: [] })
    })
    const user = userEvent.setup()
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())
    expect(screen.queryByText('Fulano')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Somente minhas ações'))
    expect(screen.getByText('Fulano')).toBeInTheDocument()
  })

  it('lista os projetos selecionados no seletor', async () => {
    installMockApi({
      'activity:timeline': () => ({ activities: [] }),
      'projects:list': () => ({
        projects: [makeProject({ key: 'BT' }), makeProject({ key: 'XX', selected: false })]
      })
    })
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByRole('option', { name: 'BT' })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: 'XX' })).not.toBeInTheDocument()
  })

  it('trocar o período re-executa a busca com o novo period', async () => {
    const api = installMockApi({
      'activity:timeline': () => ({ activities: [] }),
      'projects:list': () => ({ projects: [] })
    })
    const user = userEvent.setup()
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(api.count('activity:timeline')).toBe(1))
    expect(api.lastPayload('activity:timeline')).toMatchObject({ period: { type: '7d' } })

    await user.click(screen.getByText('30 dias'))
    await waitFor(() =>
      expect(api.lastPayload('activity:timeline')).toMatchObject({ period: { type: '30d' } })
    )
  })

  it('clicar no ícone externo chama shell:openIssue', async () => {
    const api = installMockApi({
      'activity:timeline': () => ({ activities: [makeActivity()] }),
      'projects:list': () => ({ projects: [] }),
      'shell:openIssue': () => ({ ok: true })
    })
    const user = userEvent.setup()
    renderWithProviders(<Timeline />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByTitle('Abrir BT-1 no Jira')).toBeInTheDocument())
    await user.click(screen.getByTitle('Abrir BT-1 no Jira'))
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-1' })
  })

  it('clicar na linha abre a gaveta com a key da atividade', async () => {
    installMockApi({
      'activity:timeline': () => ({ activities: [makeActivity()] }),
      'projects:list': () => ({ projects: [] })
    })
    const openIssue = vi.fn()
    const user = userEvent.setup()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <Timeline />
        </IssueDetailContext.Provider>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Ajustar layout')).toBeInTheDocument())
    await user.click(screen.getByTitle('BT-1'))
    expect(openIssue).toHaveBeenCalledWith('BT-1')
  })
})
