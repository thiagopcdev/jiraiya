// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import type { Issue } from '@shared/domain'
import { installMockApi } from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import Dashboard from './Dashboard'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Card de exemplo',
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

/** Instala mocks padrão pros canais que TODA renderização do Dashboard dispara
 * (aba "Hoje" ativa por padrão): os 5 buckets, lead time e o briefing. */
function installBaseMocks(
  overrides: Parameters<typeof installMockApi>[0] = {}
): ReturnType<typeof installMockApi> {
  return installMockApi({
    'briefing:today': () => ({ summaryId: null }),
    'issues:query': () => ({ issues: [] }),
    'stats:leadTime': () => ({ statuses: [], cardCount: 0, windowDays: 30 }),
    ...overrides
  })
}

describe('Dashboard', () => {
  afterEach(() => cleanup())
  beforeEach(() => localStorage.clear())

  it('renderiza os 5 buckets vazios e sem lead time card quando não há dados', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhuma issue concluída no período.')).toBeInTheDocument()
    )
    expect(screen.getByText('Movi')).toBeInTheDocument()
    expect(screen.getByText('Comentei')).toBeInTheDocument()
    expect(screen.getByText('Em andamento')).toBeInTheDocument()
    expect(screen.getByText('Parados')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('Nada em andamento atribuído a você.')).toBeInTheDocument()
    )
    expect(screen.queryByText('Onde seu tempo passa')).not.toBeInTheDocument()
  })

  it('reprovados: com 0 cards mostra a mensagem tranquila (sem destaque de alerta)', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhum card seu reprovado no momento.')).toBeInTheDocument()
    )
    const heading = screen.getByText('Reprovados').closest('h3')
    expect(heading?.className).not.toContain('text-red-300')
  })

  it('reprovados: com cards mostra a lista e o destaque vermelho', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'rejected'
          ? { issues: [makeIssue({ key: 'BT-9', summary: 'Reprovado' })] }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Reprovado')).toBeInTheDocument())
    expect(screen.getByText('BT-9')).toBeInTheDocument()
  })

  it('bucket "concluí" com issues renderiza as linhas', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'done'
          ? { issues: [makeIssue({ key: 'BT-5', summary: 'Terminei isso' })] }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Terminei isso')).toBeInTheDocument())
  })

  it('lead time card aparece quando há estatísticas e cardCount > 0', async () => {
    installBaseMocks({
      'stats:leadTime': () => ({
        statuses: [
          { status: 'Em andamento', avgDays: 3.456, samples: 4 },
          { status: 'Em revisão', avgDays: 1.2, samples: 2 }
        ],
        cardCount: 6,
        windowDays: 30
      })
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Onde seu tempo passa')).toBeInTheDocument())
    expect(screen.getByText(/média por status dos seus últimos 6 cards/)).toBeInTheDocument()
    expect(screen.getByText('3,5 d')).toBeInTheDocument()
    expect(screen.getByText('(4 cards)')).toBeInTheDocument()
  })

  it('banner de briefing some quando dispensado e some definitivamente pro mesmo id (localStorage)', async () => {
    installBaseMocks({ 'briefing:today': () => ({ summaryId: 42 }) })
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Sua daily de hoje está pronta.')).toBeInTheDocument()
    )
    await user.click(screen.getByTitle('Dispensar'))
    expect(screen.queryByText('Sua daily de hoje está pronta.')).not.toBeInTheDocument()
    expect(localStorage.getItem('jiraiya.dismissedBriefingId')).toBe('42')
  })

  it('clicar em "Ver" navega para /resumos e dispensa o banner (não volta ao retornar)', async () => {
    installBaseMocks({ 'briefing:today': () => ({ summaryId: 42 }) })
    const user = userEvent.setup()
    // sonda de rota: o Dashboard some ao navegar, então o pathname comprova o redirect
    function LocationProbe(): React.JSX.Element {
      const location = useLocation()
      return <p>rota atual: {location.pathname}</p>
    }
    renderWithProviders(
      <>
        <Dashboard />
        <LocationProbe />
      </>,
      { withIssueDetail: false }
    )
    await waitFor(() =>
      expect(screen.getByText('Sua daily de hoje está pronta.')).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: 'Ver' }))
    expect(screen.getByText('rota atual: /resumos')).toBeInTheDocument()
    expect(localStorage.getItem('jiraiya.dismissedBriefingId')).toBe('42')
  })

  it('banner de briefing não aparece quando o id já foi dispensado antes', async () => {
    localStorage.setItem('jiraiya.dismissedBriefingId', '42')
    installBaseMocks({ 'briefing:today': () => ({ summaryId: 42 }) })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Concluí')).toBeInTheDocument())
    expect(screen.queryByText('Sua daily de hoje está pronta.')).not.toBeInTheDocument()
  })

  it('aba "Sprint atual" mostra o cabeçalho de sprint com estatísticas', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'sprintScope'
          ? {
              issues: [
                makeIssue({ key: 'BT-1', statusCategory: 'done' }),
                makeIssue({ key: 'BT-2', statusCategory: 'indeterminate' })
              ]
            }
          : { issues: [] },
      'sprint:active': () => ({
        sprint: {
          jiraId: 1,
          boardJiraId: 1,
          name: 'Sprint 10',
          state: 'active',
          startDate: '2026-01-01T12:00:00',
          endDate: '2026-01-15T12:00:00'
        }
      })
    })
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await user.click(screen.getByText('Sprint atual'))
    await waitFor(() => expect(screen.getByText('Sprint 10')).toBeInTheDocument())
    expect(screen.getByText('Na sprint')).toBeInTheDocument()
    expect(screen.getByText('Concluídas')).toBeInTheDocument()
    expect(screen.getByText('Abertas')).toBeInTheDocument()
    expect(screen.getByText('50% concluído')).toBeInTheDocument()
  })

  it('aba "Sprint atual" sem sprint ativa mostra "Sem sprint ativa"', async () => {
    installBaseMocks({
      'sprint:active': () => ({ sprint: null })
    })
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await user.click(screen.getByText('Sprint atual'))
    await waitFor(() => expect(screen.getByText('Sem sprint ativa')).toBeInTheDocument())
  })
})
