// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Issue, SprintTrend, TeamMemberSummary } from '@shared/domain'
import { standupReference } from '@shared/periods'
import { installMockApi, MockIpcFailure } from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import Team from './Team'

/**
 * standupReference depende de `new Date()` — em vez de mockar o relógio global
 * (frágil com timers/animações), controlamos direto o retorno da função pura
 * que decide "ontem" vs "sexta-feira" (fim de semana).
 */
vi.mock('@shared/periods', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/periods')>()
  return { ...actual, standupReference: vi.fn(actual.standupReference) }
})
const mockedStandupReference = vi.mocked(standupReference)

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
    assigneeAccountId: 'acc-1',
    assigneeName: 'Ana',
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

function makeMember(overrides: Partial<TeamMemberSummary> = {}): TeamMemberSummary {
  return {
    accountId: 'acc-1',
    name: 'Ana',
    isMe: true,
    inProgress: [],
    done: [],
    stalled: [],
    movedCount: 0,
    commentedCount: 0,
    ...overrides
  }
}

const aiInactive = {
  'ai:status': () => ({ providers: [], active: null, activePref: 'auto' }) as never
}
const aiActive = {
  'ai:status': () =>
    ({
      providers: [
        { id: 'claude', label: 'Claude', kind: 'cli', available: true, detail: null, models: [] }
      ],
      active: { id: 'claude', label: 'Claude' },
      activePref: 'auto'
    }) as never
}
const noRisk = { 'sprint:risk': () => ({ sprint: null, items: [] }) }
const fewTrends = { 'team:trends': () => ({ sprints: [] }) }
const noVelocity = {
  'team:velocity': () => ({
    sprints: [],
    totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 }
  })
}

describe('Team', () => {
  afterEach(() => cleanup())

  it('mostra o spinner enquanto o time carrega', () => {
    installMockApi({
      ...aiInactive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => new Promise(() => {})
    })
    renderWithProviders(<Team />, { withIssueDetail: false })
    expect(document.querySelectorAll('.animate-spin').length).toBeGreaterThan(0)
  })

  it('estado vazio quando ninguém teve atividade no período', async () => {
    installMockApi({
      ...aiInactive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({ members: [], periodLabel: '7 dias', syncMode: 'project' })
    })
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() =>
      expect(
        screen.getByText('Ninguém com atividade no período. Sincronize ou amplie o período.')
      ).toBeInTheDocument()
    )
  })

  const anaWithWork = {
    'team:summary': () => ({
      members: [
        makeMember({
          accountId: 'acc-1',
          name: 'Ana',
          isMe: true,
          movedCount: 2,
          commentedCount: 1,
          inProgress: [
            makeIssue({ key: 'BT-1', priority: 'Highest', flagged: false }),
            makeIssue({ key: 'BT-2', priority: 'Medium' })
          ],
          done: [makeIssue({ key: 'BT-3', storyPoints: 3 })],
          stalled: [{ ...makeIssue({ key: 'BT-4' }), stalledDays: 5 }]
        })
      ],
      periodLabel: '7 dias',
      syncMode: 'project' as const
    })
  }

  it('linha da pessoa traz os três números, os sinais de risco e o contexto do cabeçalho', async () => {
    installMockApi({ ...aiInactive, ...noRisk, ...fewTrends, ...noVelocity, ...anaWithWork })
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())

    expect(screen.getByText('7 dias · 1 pessoa · 2 cards em andamento')).toBeInTheDocument()

    const row = screen.getByTitle('Ver os cards')
    expect(within(row).getByText('você · 2 movida(s) · 1 comentada(s)')).toBeInTheDocument()
    expect(within(row).getByText('em andamento')).toBeInTheDocument()
    expect(within(row).getByText('concluídas')).toBeInTheDocument()
    // sp da linha = story points do que a pessoa concluiu
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(within(row).getByText('1 bloqueado(s)')).toBeInTheDocument()
    expect(within(row).getByText('1 parado(s)')).toBeInTheDocument()
  })

  it('a lista de cards da pessoa fica recolhida e abre no clique da linha', async () => {
    installMockApi({ ...aiInactive, ...noRisk, ...fewTrends, ...noVelocity, ...anaWithWork })
    const user = userEvent.setup()
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())

    expect(screen.queryByText('Bloqueado')).not.toBeInTheDocument()

    await user.click(screen.getByTitle('Ver os cards'))
    expect(screen.getByText('Bloqueado')).toBeInTheDocument()
    expect(screen.getByText('Parado')).toBeInTheDocument()
    expect(screen.getByText('BT-4')).toBeInTheDocument()
    expect(screen.getByText('5d')).toBeInTheDocument()
  })

  it('pessoa sem movimentação e sem cards mostra o subtítulo de fallback', async () => {
    installMockApi({
      ...aiInactive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({
        members: [makeMember({ accountId: 'acc-2', name: 'Bruno', isMe: false })],
        periodLabel: 'hoje',
        syncMode: 'project' as const
      })
    })
    const user = userEvent.setup()
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Bruno')).toBeInTheDocument())
    expect(screen.getByText('sem movimentações no período')).toBeInTheDocument()

    await user.click(screen.getByTitle('Ver os cards'))
    expect(screen.getByText('Nada em andamento.')).toBeInTheDocument()
  })

  it('banner de modo pessoal aparece quando syncMode é "personal"', async () => {
    installMockApi({
      ...aiInactive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({ members: [], periodLabel: '7 dias', syncMode: 'personal' })
    })
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText(/O sync está em modo pessoal/)).toBeInTheDocument())
  })

  it('botão "Resumir time" fica desabilitado sem provider de IA ativo', async () => {
    installMockApi({
      ...aiInactive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({
        members: [makeMember()],
        periodLabel: '7 dias',
        syncMode: 'project'
      })
    })
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    expect(screen.getByText('Resumir time').closest('button')).toBeDisabled()
  })

  it('gera a narrativa do time com IA ativa e mostra o markdown retornado', async () => {
    const api = installMockApi({
      ...aiActive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({
        members: [makeMember()],
        periodLabel: '7 dias',
        syncMode: 'project'
      }),
      'team:narrative': () => ({ ok: true, markdown: 'Time indo bem essa semana.' })
    })
    const user = userEvent.setup()
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())

    const button = screen.getByText('Resumir time').closest('button')!
    expect(button).not.toBeDisabled()
    await user.click(button)

    await waitFor(() => expect(screen.getByText('Time indo bem essa semana.')).toBeInTheDocument())
    expect(api.lastPayload('team:narrative')).toEqual({ period: { type: '7d' } })
  })

  it('trocar o período reconsulta team:summary com o novo period e limpa a narrativa', async () => {
    const api = installMockApi({
      ...aiActive,
      ...noRisk,
      ...fewTrends,
      ...noVelocity,
      'team:summary': () => ({
        members: [makeMember()],
        periodLabel: '7 dias',
        syncMode: 'project'
      }),
      'team:narrative': () => ({ ok: true, markdown: 'Narrativa.' })
    })
    const user = userEvent.setup()
    renderWithProviders(<Team />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())

    await user.click(screen.getByText('Resumir time'))
    await waitFor(() => expect(screen.getByText('Narrativa.')).toBeInTheDocument())

    await user.click(screen.getByText('Hoje'))
    await waitFor(() =>
      expect(api.lastPayload('team:summary')).toEqual({ period: { type: 'today' } })
    )
    expect(screen.queryByText('Narrativa.')).not.toBeInTheDocument()
  })

  describe('velocidade', () => {
    it('mostra o spinner enquanto a velocity carrega', () => {
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'team:velocity': () => new Promise(() => {})
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      expect(document.querySelectorAll('.animate-spin').length).toBeGreaterThan(0)
    })

    it('renderiza o total de SP quando há sprints', async () => {
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'team:velocity': () => ({
          sprints: [
            {
              sprintJiraId: 1,
              name: 'Sprint 1',
              state: 'closed',
              startDate: '2026-01-01T12:00:00',
              endDate: '2026-01-14T12:00:00',
              myPoints: 3,
              teamPoints: 8,
              myCount: 2,
              teamCount: 4
            }
          ],
          totals: { myPoints: 3, teamPoints: 8, myCount: 2, teamCount: 4 }
        })
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      // números em negrito são <span>, então a asserção olha os pedaços da legenda
      await waitFor(() => expect(screen.getByText('3 SP')).toBeInTheDocument())
      expect(screen.getByText('8 SP')).toBeInTheDocument()
      expect(screen.getByText(/do time · 4 cards/)).toBeInTheDocument()
    })

    it('sem sprints e sem loading, não mostra o card de entregas', async () => {
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' })
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() =>
        expect(
          screen.getByText('Ninguém com atividade no período. Sincronize ou amplie o período.')
        ).toBeInTheDocument()
      )
      expect(screen.queryByText('Entregas por sprint')).not.toBeInTheDocument()
    })
  })

  describe('tendências', () => {
    it('menos de 2 sprints fechadas mostra o aviso', async () => {
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'team:trends': () => ({ sprints: [] })
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      // sem material para comparar é linha de ~26px, não cartão (regra 3)
      await waitFor(() =>
        expect(screen.getByText('poucas sprints fechadas para comparar')).toBeInTheDocument()
      )
      expect(
        screen.queryByRole('heading', { name: 'Tendências (últimas sprints)' })
      ).not.toBeInTheDocument()
    })

    it('com 2+ sprints mostra a tabela de tendências', async () => {
      const trends: SprintTrend[] = [
        {
          jiraId: 1,
          name: 'Sprint 1',
          endDate: '2026-01-14T12:00:00',
          deliveredSp: 10,
          deliveredCount: 4,
          avgLeadDays: 2.567,
          createdDuringCount: 1
        },
        {
          jiraId: 2,
          name: 'Sprint 2',
          endDate: '2026-01-28T12:00:00',
          deliveredSp: 12,
          deliveredCount: 5,
          avgLeadDays: null,
          createdDuringCount: 0
        }
      ]
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'team:trends': () => ({ sprints: trends })
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Sprint 1')).toBeInTheDocument())
      expect(screen.getByText('Sprint 2')).toBeInTheDocument()
      expect(screen.getByText('10 SP')).toBeInTheDocument()
      expect(screen.getByText('2,6d')).toBeInTheDocument()
      expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    })
  })

  describe('radar de risco', () => {
    it('não renderiza nada sem sprint ou sem itens', async () => {
      installMockApi({
        ...aiInactive,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'sprint:risk': () => ({ sprint: null, items: [] })
      })
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() =>
        expect(
          screen.getByText('Ninguém com atividade no período. Sincronize ou amplie o período.')
        ).toBeInTheDocument()
      )
      expect(screen.queryByText('Radar de risco')).not.toBeInTheDocument()
    })

    it('renderiza itens de risco com sinais e explica com IA', async () => {
      const api = installMockApi({
        ...aiActive,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' }),
        'sprint:risk': () => ({
          sprint: { jiraId: 1, name: 'Sprint 1' },
          items: [
            {
              issue: makeIssue({ key: 'BT-9', summary: 'Card arriscado' }),
              signals: ['sem estimativa', 'parado'],
              score: 3
            }
          ]
        }),
        'sprint:riskExplain': () => ({ markdown: 'Risco alto por atraso.', generatedBy: 'claude' })
      })
      const user = userEvent.setup()
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Card arriscado')).toBeInTheDocument())
      expect(screen.getByText('BT-9')).toBeInTheDocument()
      // score >= 2 pinta os sinais de âmbar — é o que separa risco de ruído
      const signals = screen.getByText('sem estimativa · parado')
      expect(signals.className).toContain('text-amber-400')

      await user.click(screen.getByText(/Explicar com/))
      await waitFor(() => expect(screen.getByText('Risco alto por atraso.')).toBeInTheDocument())
      expect(api.count('sprint:riskExplain')).toBe(1)
    })
  })

  describe('Standup', () => {
    afterEach(() => mockedStandupReference.mockReset())

    it('mostra visão de standup do último dia útil (terça -> ontem)', async () => {
      mockedStandupReference.mockReturnValue({ period: { type: 'yesterday' }, label: 'ontem' })
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => ({
          members: [
            makeMember({
              accountId: 'acc-1',
              name: 'Ana',
              isMe: true,
              done: [makeIssue({ key: 'BT-1', summary: 'Terminado' })],
              inProgress: [makeIssue({ key: 'BT-2', summary: 'Rolando' })]
            })
          ],
          periodLabel: 'ontem',
          syncMode: 'project'
        })
      })
      const user = userEvent.setup()
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Standup')).toBeInTheDocument())
      await user.click(screen.getByText('Standup'))

      await waitFor(() => expect(screen.getByText('Terminado')).toBeInTheDocument())
      expect(screen.getByText('Concluiu')).toBeInTheDocument()
      expect(screen.getByText(/Ontem: moveu/)).toBeInTheDocument()
      expect(screen.getByText('Rolando')).toBeInTheDocument()
    })

    it('segunda-feira usa a sexta-feira como referência (fim de semana)', async () => {
      mockedStandupReference.mockReturnValue({
        period: {
          type: 'custom',
          start: '2026-01-02T00:00:00.000Z',
          end: '2026-01-03T00:00:00.000Z'
        },
        label: 'na sexta-feira'
      })
      const api = installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => ({ members: [], periodLabel: '', syncMode: 'project' })
      })
      const user = userEvent.setup()
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Standup')).toBeInTheDocument())
      await user.click(screen.getByText('Standup'))

      await waitFor(() =>
        expect(screen.getByText('Ninguém com atividade na sexta-feira.')).toBeInTheDocument()
      )
      const customCall = api.calls.find(
        (c) =>
          c.channel === 'team:summary' &&
          typeof c.payload === 'object' &&
          c.payload !== null &&
          (c.payload as { period: { type: string } }).period.type === 'custom'
      )
      expect(customCall).toBeDefined()
    })

    it('erro no standup mostra o estado de erro (não vazio silencioso)', async () => {
      mockedStandupReference.mockReturnValue({ period: { type: 'yesterday' }, label: 'ontem' })
      installMockApi({
        ...aiInactive,
        ...noRisk,
        ...fewTrends,
        ...noVelocity,
        'team:summary': () => {
          throw new MockIpcFailure('SUMMARY_FAIL', 'Não foi possível carregar o standup')
        }
      })
      const user = userEvent.setup()
      renderWithProviders(<Team />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Standup')).toBeInTheDocument())
      await user.click(screen.getByText('Standup'))

      await waitFor(() =>
        expect(screen.getByText('Não foi possível carregar o standup')).toBeInTheDocument()
      )
    })
  })
})
