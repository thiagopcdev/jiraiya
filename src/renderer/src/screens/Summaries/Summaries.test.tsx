// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, type MockHandlers } from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import Summaries from './Summaries'

afterEach(cleanup)

const aiStatusWithClaude = {
  providers: [
    { id: 'claude', label: 'Claude', kind: 'cli', available: true, detail: null, models: [] }
  ],
  active: { id: 'claude', label: 'Claude' },
  activePref: 'auto'
} as const

const aiStatusUnavailable = {
  providers: [],
  active: null,
  activePref: 'auto'
} as const

function baseHandlers(overrides: MockHandlers = {}): MockHandlers {
  return {
    'ai:status': () => aiStatusUnavailable as never,
    'summaries:list': () => ({ summaries: [] }),
    'sprint:list': () => ({ sprints: [] }),
    ...overrides
  }
}

function renderSummaries(
  handlers: MockHandlers = {},
  openIssue = vi.fn()
): ReturnType<typeof renderWithProviders> {
  installMockApi(baseHandlers(handlers))
  return renderWithProviders(
    <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
      <Summaries />
    </IssueDetailContext.Provider>,
    { withIssueDetail: false }
  )
}

describe('Summaries', () => {
  it('gera resumo por template (sem IA) e não mostra badge de IA', async () => {
    installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: '# Standup\n- fiz X', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByDisplayValue(/fiz X/)).toBeInTheDocument())
    expect(screen.queryByText(/gerado com/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Gerado por template —/)).not.toBeInTheDocument()
  })

  it('gera resumo com IA e mostra badge "gerado com <provider>"', async () => {
    const api = installMockApi(
      baseHandlers({
        'ai:status': () => aiStatusWithClaude as never,
        'summaries:generate': () => ({ markdown: '# Standup IA', generatedBy: 'claude' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByText(/gerado com Claude/)).toBeInTheDocument())
    expect(api.lastPayload('summaries:generate')).toMatchObject({
      template: 'standup',
      useClaude: true
    })
  })

  it('checkbox de IA desabilitado quando não há provider ativo', async () => {
    renderSummaries()
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled())
  })

  it('fallback: pediu IA mas veio de template — mostra aviso', async () => {
    installMockApi(
      baseHandlers({
        'ai:status': () => aiStatusWithClaude as never,
        'summaries:generate': () => ({ markdown: '# Standup', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() =>
      expect(screen.getByText(/Gerado por template — Claude indisponível/)).toBeInTheDocument()
    )
  })

  it('salva o resumo gerado no histórico', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: '# conteúdo', generatedBy: 'template' }),
        'summaries:save': () => ({ id: 1 })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByDisplayValue(/conteúdo/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Salvar no histórico/ }))
    await waitFor(() => expect(api.count('summaries:save')).toBe(1))
    expect(api.lastPayload('summaries:save')).toMatchObject({
      template: 'standup',
      contentMd: '# conteúdo',
      generatedBy: 'template'
    })
  })

  it('lista histórico, carrega no editor ao clicar e exclui', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:list': () => ({
          summaries: [
            {
              id: 7,
              periodType: '7d',
              periodStart: '2026-01-01',
              periodEnd: '2026-01-07',
              template: 'weekly',
              contentMd: '## Resumo semanal salvo',
              generatedBy: 'claude',
              createdAt: '2026-01-08T10:00:00.000Z',
              editedAt: null
            }
          ]
        }),
        'summaries:delete': () => ({ ok: true })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByTitle('Carregar no editor')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('Carregar no editor'))
    await waitFor(() =>
      expect(screen.getByDisplayValue(/Resumo semanal salvo/)).toBeInTheDocument()
    )

    await userEvent.click(screen.getByTitle('Excluir'))
    await waitFor(() => expect(api.count('summaries:delete')).toBe(1))
    expect(api.lastPayload('summaries:delete')).toEqual({ id: 7 })
  })

  it('histórico vazio mostra o EmptyState', async () => {
    renderSummaries()
    await waitFor(() => expect(screen.getByText('Nenhum resumo salvo ainda.')).toBeInTheDocument())
  })

  it('retro de sprint: seleciona sprint e chama summaries:sprintRetro', async () => {
    const api = installMockApi(
      baseHandlers({
        'sprint:list': () => ({
          sprints: [
            {
              jiraId: 10,
              name: 'Sprint 10',
              state: 'closed',
              startDate: '2026-01-01',
              endDate: '2026-01-14'
            },
            {
              jiraId: 11,
              name: 'Sprint 11 (ativa)',
              state: 'active',
              startDate: '2026-01-15',
              endDate: null
            }
          ]
        }),
        'summaries:sprintRetro': () => ({ markdown: '# Retro', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    const formatSelect = screen.getByDisplayValue('Daily') as HTMLSelectElement
    await userEvent.selectOptions(formatSelect, 'sprint_retro')

    await waitFor(() => expect(screen.getByText(/Sprint 10/)).toBeInTheDocument())
    // sprint fechada mais recente é o default
    expect(screen.getByRole('combobox', { name: 'Sprint' })).toHaveValue('10')

    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(api.count('summaries:sprintRetro')).toBe(1))
    expect(api.lastPayload('summaries:sprintRetro')).toMatchObject({ sprintJiraId: 10 })
  })

  it('sem sprints, botão de gerar fica desabilitado no modo retro', async () => {
    renderSummaries()
    const formatSelect = screen.getByDisplayValue('Daily')
    await userEvent.selectOptions(formatSelect, 'sprint_retro')
    await waitFor(() => expect(screen.getByText('Nenhuma sprint encontrada')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Gerar resumo/ })).toBeDisabled()
  })

  it('copia o resumo para a área de transferência', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: 'conteúdo copiável', generatedBy: 'template' }),
        'export:clipboard': () => ({ ok: true })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByDisplayValue(/conteúdo copiável/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Copiar$/ }))
    expect(api.lastPayload('export:clipboard')).toEqual({ text: 'conteúdo copiável' })
    await waitFor(() => expect(screen.getByText('Copiado!')).toBeInTheDocument())
  })

  it('exporta o resumo como arquivo .md', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: 'conteúdo export', generatedBy: 'template' }),
        'export:file': () => ({ saved: true, path: '/tmp/x.md' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByDisplayValue(/conteúdo export/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Exportar \.md/ }))
    await waitFor(() => expect(api.count('export:file')).toBe(1))
    expect(api.lastPayload('export:file')).toMatchObject({ content: 'conteúdo export' })
  })

  it('chips de cards citados abrem a gaveta ao clicar', async () => {
    const openIssue = vi.fn()
    installMockApi(
      baseHandlers({
        'summaries:generate': () => ({
          markdown: 'Trabalhei em BT-123 e também em BT-456.',
          generatedBy: 'template'
        })
      })
    )
    renderWithProviders(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <Summaries />
      </IssueDetailContext.Provider>,
      { withIssueDetail: false }
    )
    await userEvent.click(screen.getByRole('button', { name: /Gerar resumo/ }))
    await waitFor(() => expect(screen.getByText('BT-123')).toBeInTheDocument())
    expect(screen.getByText('BT-456')).toBeInTheDocument()

    await userEvent.click(screen.getByText('BT-123'))
    expect(openIssue).toHaveBeenCalledWith('BT-123')
  })

  describe('worklogs do período', () => {
    it('gera, mostra linhas com total e abre card ao clicar na key', async () => {
      const openIssue = vi.fn()
      const api = installMockApi(
        baseHandlers({
          'worklog:export': () => ({
            rows: [
              {
                date: '2026-01-05T00:00:00.000Z',
                key: 'BT-1',
                summary: 'Ajuste X',
                timeSpent: '1h 30m',
                seconds: 5400,
                comment: 'revisão de código'
              }
            ],
            totalSeconds: 5400
          })
        })
      )
      renderWithProviders(
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <Summaries />
        </IssueDetailContext.Provider>,
        { withIssueDetail: false }
      )

      await userEvent.click(screen.getByRole('button', { name: /^Gerar$/ }))
      await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())
      // uma no corpo da linha ('1h 30m' vindo do timeSpent), outra no total (formatSecondsHm)
      expect(screen.getAllByText('1h 30m')).toHaveLength(2)
      expect(api.count('worklog:export')).toBe(1)

      await userEvent.click(screen.getByText('BT-1'))
      expect(openIssue).toHaveBeenCalledWith('BT-1')
    })

    it('sem worklogs no período mostra EmptyState específico', async () => {
      installMockApi(baseHandlers({ 'worklog:export': () => ({ rows: [], totalSeconds: 0 }) }))
      renderWithProviders(<Summaries />, { withIssueDetail: false })
      await userEvent.click(screen.getByRole('button', { name: /^Gerar$/ }))
      await waitFor(() =>
        expect(screen.getByText('Nenhum worklog seu no período.')).toBeInTheDocument()
      )
    })

    it('copia como markdown e exporta CSV', async () => {
      const api = installMockApi(
        baseHandlers({
          'worklog:export': () => ({
            rows: [
              {
                date: '2026-01-05T00:00:00.000Z',
                key: 'BT-1',
                summary: 'Ajuste X',
                timeSpent: '1h',
                seconds: 3600,
                comment: null
              }
            ],
            totalSeconds: 3600
          }),
          'export:clipboard': () => ({ ok: true }),
          'export:file': () => ({ saved: true, path: null })
        })
      )
      renderWithProviders(<Summaries />, { withIssueDetail: false })
      await userEvent.click(screen.getByRole('button', { name: /^Gerar$/ }))
      await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /Copiar \(markdown\)/ }))
      await waitFor(() => expect(api.count('export:clipboard')).toBe(1))
      expect(api.lastPayload('export:clipboard')).toMatchObject({
        text: expect.stringContaining('BT-1')
      })

      await userEvent.click(screen.getByRole('button', { name: /Exportar CSV/ }))
      await waitFor(() => expect(api.count('export:file')).toBe(1))
      expect(api.lastPayload('export:file')).toMatchObject({
        content: expect.stringContaining('date,key,summary,timeSpent,seconds,comment')
      })
    })

    it('troca o período do worklog via select', async () => {
      const api = installMockApi(
        baseHandlers({ 'worklog:export': () => ({ rows: [], totalSeconds: 0 }) })
      )
      renderWithProviders(<Summaries />, { withIssueDetail: false })

      const worklogCard = screen.getByText('Worklogs do período').closest('div')!.parentElement!
      const periodSelect = within(worklogCard).getByDisplayValue('Esta semana')
      await userEvent.selectOptions(periodSelect, 'Mês passado')

      await userEvent.click(screen.getByRole('button', { name: /^Gerar$/ }))
      await waitFor(() => expect(api.count('worklog:export')).toBe(1))
      const payload = api.lastPayload('worklog:export') as { start: string; end: string }
      expect(payload.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(payload.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})
