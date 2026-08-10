// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import type { Issue } from '@shared/domain'
import { DEFAULT_PREFS } from '@shared/domain'
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

const ME = 'acc-me'

/** Instala mocks padrão pros canais que TODA renderização da tela "Hoje"
 * dispara: os buckets, sprint ativo, lead time, auth (accountId) e prefs
 * (density/stalledDays) — `prefs:get`/`prefs:set` compartilham um estado
 * mutável, então o toggle de densidade otimista pode ser verificado
 * ponta-a-ponta (aplica local e sobrevive ao refetch pós-invalidate). */
function installBaseMocks(
  overrides: Parameters<typeof installMockApi>[0] = {}
): ReturnType<typeof installMockApi> {
  const prefsState = { ...DEFAULT_PREFS }
  return installMockApi({
    'briefing:today': () => ({ summaryId: null }),
    'issues:query': () => ({ issues: [] }),
    'stats:leadTime': () => ({ statuses: [], cardCount: 0, windowDays: 30 }),
    'sprint:active': () => ({ sprint: null }),
    'auth:status': () => ({
      connected: true,
      workspace: {
        id: 1,
        siteUrl: 'https://x.atlassian.net',
        email: 'me@x.com',
        accountId: ME,
        displayName: 'Thiago',
        timeZone: null
      }
    }),
    'prefs:get': () => ({ ...prefsState }),
    'prefs:set': (patch) => {
      Object.assign(prefsState, patch)
      return { ...prefsState }
    },
    ...overrides
  })
}

describe('Dashboard (tela "Hoje")', () => {
  afterEach(() => cleanup())
  beforeEach(() => localStorage.clear())

  it('cabeçalho: título "Hoje" e faixa de abas de período', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    expect(screen.getByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByText('Hoje', { selector: 'button' })).toBeInTheDocument()
    expect(screen.getByText('7 dias')).toBeInTheDocument()
    expect(screen.getByText('Sprint')).toBeInTheDocument()
    // aba sublinhada: a ativa se anuncia com aria-current, não com aria-pressed
    expect(screen.getByText('Hoje', { selector: 'button' })).toHaveAttribute('aria-current', 'page')
  })

  it('trocar de aba de período move o aria-current e reconsulta os buckets do período', async () => {
    const api = installBaseMocks()
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(api.count('issues:query')).toBeGreaterThan(0))

    await user.click(screen.getByText('7 dias'))
    expect(screen.getByText('7 dias')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Hoje', { selector: 'button' })).not.toHaveAttribute('aria-current')
    await waitFor(() =>
      expect(
        api.calls.some((call) => {
          if (call.channel !== 'issues:query') return false
          const payload = call.payload as { bucket?: string; period: { type: string } }
          return payload.bucket === 'inProgress' && payload.period.type === '7d'
        })
      ).toBe(true)
    )
  })

  it('SprintStrip aparece mesmo na aba "Hoje" (não só na aba Sprint) e mostra "Sem sprint ativa"', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Sem sprint ativa')).toBeInTheDocument())
  })

  it('SprintStrip com sprint ativa mostra nome e estatísticas', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'sprintScope'
          ? {
              issues: [
                makeIssue({ key: 'BT-1', statusCategory: 'done', storyPoints: 3 }),
                makeIssue({ key: 'BT-2', statusCategory: 'indeterminate', storyPoints: 5 })
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
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Sprint 10')).toBeInTheDocument())
    expect(screen.getByText('na sprint')).toBeInTheDocument()
    expect(screen.getByText('concluídas')).toBeInTheDocument()
    expect(screen.getByText('abertas')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('CollapsedStats: tudo zerado vira uma linha só ("Nada exigindo atenção")', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Nada exigindo atenção')).toBeInTheDocument())
    expect(screen.queryByText('Reprovado urgente')).not.toBeInTheDocument()
  })

  it('CollapsedStats: com reprovados abre em lista de atenção (vermelho)', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'rejected'
          ? { issues: [makeIssue({ key: 'BT-9', summary: 'Reprovado urgente' })] }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Reprovado urgente')).toBeInTheDocument())
    expect(screen.getByText('BT-9')).toBeInTheDocument()
    expect(screen.queryByText('Nada exigindo atenção')).not.toBeInTheDocument()
  })

  it('"Sem estimativa" deriva do bucket sprintScope (storyPoints null), sem bucket próprio', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'sprintScope'
          ? { issues: [makeIssue({ key: 'BT-30', storyPoints: null, statusCategory: 'new' })] }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    // "Sem estimativa" só vira grupo de atenção (fora do CollapsedStats
    // colapsado) quando count > 0 — a label e a contagem ficam em nós de
    // texto separados (rótulo + badge), por isso duas asserções.
    await waitFor(() => expect(screen.getByText('Sem estimativa')).toBeInTheDocument())
    expect(screen.getByText('Card de exemplo')).toBeInTheDocument()
  })

  it('"Em andamento" vazio mostra a mensagem de vazio', async () => {
    installBaseMocks()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nada em andamento atribuído a você.')).toBeInTheDocument()
    )
  })

  it('"Em andamento" com issues renderiza agrupado por status (IssuesByStatus)', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'inProgress'
          ? { issues: [makeIssue({ key: 'BT-50', summary: 'Card em progresso' })] }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Card em progresso')).toBeInTheDocument())
    expect(screen.getByText('BT-50')).toBeInTheDocument()
  })

  it('"A fazer nesta sprint" deriva do sprintScope (statusCategory=new + responsável=eu)', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'sprintScope'
          ? {
              issues: [
                makeIssue({
                  key: 'BT-70',
                  summary: 'Vou fazer isso depois',
                  statusCategory: 'new',
                  assigneeAccountId: ME,
                  storyPoints: 5
                }),
                // não é meu — não deve entrar na lista (storyPoints setado pra
                // não vazar também pro grupo "sem estimativa")
                makeIssue({
                  key: 'BT-71',
                  summary: 'Da colega',
                  statusCategory: 'new',
                  assigneeAccountId: 'outra-pessoa',
                  storyPoints: 2
                })
              ]
            }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Vou fazer isso depois')).toBeInTheDocument())
    expect(screen.queryByText('Da colega')).not.toBeInTheDocument()
    expect(screen.getByText('A fazer nesta sprint')).toBeInTheDocument()
  })

  it('rodapé do painel primário soma só os cards da sprint atribuídos a mim e linka pro quadro', async () => {
    installBaseMocks({
      'issues:query': (payload) =>
        payload.bucket === 'sprintScope'
          ? {
              issues: [
                makeIssue({ key: 'BT-80', assigneeAccountId: ME, storyPoints: 5 }),
                makeIssue({ key: 'BT-81', assigneeAccountId: 'outra-pessoa', storyPoints: 8 })
              ]
            }
          : { issues: [] }
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1 card · 5 sp')).toBeInTheDocument())
    const link = screen.getByRole('link', { name: 'abrir no quadro' })
    expect(link).toHaveAttribute('href', '/quadro')
  })

  it('trilho "Sua atividade": mescla concluí/movi/comentei e filtra pelos chips (chip com 0 fica desabilitado)', async () => {
    installBaseMocks({
      'issues:query': (payload) => {
        if (payload.bucket === 'done')
          return {
            issues: [
              makeIssue({
                key: 'BT-100',
                summary: 'Terminei essa',
                resolvedAt: '2026-08-01T09:12:00.000Z'
              })
            ]
          }
        if (payload.bucket === 'commented')
          return {
            issues: [
              makeIssue({
                key: 'BT-101',
                summary: 'Comentei aqui',
                updatedAt: '2026-08-01T14:20:00.000Z'
              })
            ]
          }
        return { issues: [] }
      }
    })
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })

    // a linha mistura texto solto com o <span> mono da key, então o rótulo
    // acessível do botão (soma de todos os descendentes) é o jeito confiável
    // de achar a linha inteira — getByText sozinho não concatena o span
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Terminei essa/ })).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /Comentei aqui/ })).toBeInTheDocument()

    const movedChip = screen.getByRole('button', { name: 'Movi 0' })
    expect(movedChip).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Concluí 1' }))
    expect(screen.getByRole('button', { name: /Terminei essa/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Comentei aqui/ })).not.toBeInTheDocument()
  })

  it('lead time card aparece quando há estatísticas e cardCount > 0', async () => {
    installBaseMocks({
      'stats:leadTime': () => ({
        statuses: [{ status: 'Em andamento', avgDays: 3.456, samples: 4 }],
        cardCount: 6,
        windowDays: 30
      })
    })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Onde seu tempo passa')).toBeInTheDocument())
    expect(screen.getByText(/média por status dos seus últimos 6 cards/)).toBeInTheDocument()
    expect(screen.getByText('3,5d')).toBeInTheDocument()
  })

  it('toggle de densidade: otimista local + prefs:set, e o rótulo acompanha o refetch', async () => {
    const api = installBaseMocks()
    const user = userEvent.setup()
    renderWithProviders(<Dashboard />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByText('confortável')).toBeInTheDocument())
    await user.click(screen.getByText('confortável'))

    // otimista: aplica no <html> antes do round-trip do IPC terminar
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(localStorage.getItem('jiraiya.density')).toBe('compact')

    await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ density: 'compact' }))
    await waitFor(() => expect(screen.getByText('denso')).toBeInTheDocument())
  })

  it('atalho "Daily pronta" no cabeçalho: clicar navega para /resumos e dispensa (ver = ciente)', async () => {
    installBaseMocks({ 'briefing:today': () => ({ summaryId: 42 }) })
    const user = userEvent.setup()
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
    await waitFor(() => expect(screen.getByText('Daily pronta')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Daily pronta/ }))
    expect(screen.getByText('rota atual: /resumos')).toBeInTheDocument()
    expect(localStorage.getItem('jiraiya.dismissedBriefingId')).toBe('42')
  })

  it('atalho "Daily pronta" não aparece quando o id já foi dispensado antes', async () => {
    localStorage.setItem('jiraiya.dismissedBriefingId', '42')
    installBaseMocks({ 'briefing:today': () => ({ summaryId: 42 }) })
    renderWithProviders(<Dashboard />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Em andamento')).toBeInTheDocument())
    expect(screen.queryByText('Daily pronta')).not.toBeInTheDocument()
  })
})
