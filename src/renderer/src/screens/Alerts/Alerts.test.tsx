// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

  it('renderiza o título via ScreenHeader', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [] }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Alertas' })).toBeInTheDocument()
    )
  })

  it('estado vazio quando não há alertas nem seguidos — vira a linha colapsada (regra 1)', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [] }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhum alerta ativo. Tudo em ordem.')).toBeInTheDocument()
    )
    // resumo dos 3 contadores zerados (CollapsedStats), não um empty state por severidade
    expect(screen.getByText('Críticos 0 · Atenção 0 · Informativos 0')).toBeInTheDocument()
    // "Seguindo" sem item também é linha, não cartão com empty state
    expect(screen.getByText('Seguindo 0')).toBeInTheDocument()
    expect(
      screen.getByText('marque um card com o olho na gaveta para acompanhá-lo aqui')
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
    // contador agora é pílula na faixa de título, uma por severidade
    expect(
      within(screen.getByRole('heading', { name: /Críticos/ })).getByText('1')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('heading', { name: /Atenção/ })).getByText('2')
    ).toBeInTheDocument()
    expect(screen.getByText('atenção 1')).toBeInTheDocument()
    expect(screen.getByText('atenção 2')).toBeInTheDocument()
    // o contexto do cabeçalho soma exatamente o que a tela mostra
    expect(screen.getByText('1 críticos · 2 de atenção · 0 informativos')).toBeInTheDocument()
  })

  it('severidade sem item vira linha de ~26px, não cartão', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ severity: 'critical', message: 'só esse' })] }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('só esse')).toBeInTheDocument())
    expect(screen.getByText('0 de atenção')).toBeInTheDocument()
    expect(screen.getByText('0 informativos')).toBeInTheDocument()
    expect(screen.getAllByText('nada por aqui')).toHaveLength(2)
    // sem item não há o que abrir: o "mostrar" não aparece
    expect(screen.queryByRole('button', { name: 'mostrar' })).not.toBeInTheDocument()
  })

  it('informativo com item é cartão como as outras severidades', async () => {
    installMockApi({
      'alerts:list': () => ({
        alerts: [
          makeAlert({ id: 1, severity: 'critical', message: 'crítico 1' }),
          makeAlert({ id: 2, severity: 'info', message: 'saiu do seu radar' })
        ]
      }),
      'watch:list': () => ({ issues: [] })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    // severidade com item nunca entra colapsada — só a zerada vira linha
    await waitFor(() => expect(screen.getByText('saiu do seu radar')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Informativos/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'mostrar' })).not.toBeInTheDocument()
    // a severidade sem item nenhum, essa sim, é a linha de ~26px
    expect(screen.getByText('0 de atenção')).toBeInTheDocument()
  })

  it('não oferece dispensa em massa — só a dispensa por alerta', async () => {
    installMockApi({
      'alerts:list': () => ({ alerts: [makeAlert({ id: 3 }), makeAlert({ id: 4 })] }),
      'watch:list': () => ({ issues: [] }),
      'alerts:dismiss': () => ({ ok: true })
    })
    renderWithProviders(<Alerts />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getAllByTitle('Dispensar')).toHaveLength(2))
    expect(screen.queryByText('Dispensar todos')).not.toBeInTheDocument()
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
