// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
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

/** Botão principal da faixa de controle — "Gerar tabela" (worklogs) não colide por ser nome exato. */
function gerarButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Gerar' })
}

describe('Summaries', () => {
  it('cabeçalho conta quantos resumos estão salvos', async () => {
    renderSummaries({
      'summaries:list': () => ({
        summaries: [
          {
            id: 1,
            periodType: '7d',
            periodStart: '2026-01-01',
            periodEnd: '2026-01-07',
            template: 'weekly',
            contentMd: '## Semana',
            generatedBy: 'claude',
            createdAt: '2026-01-08T10:00:00.000Z',
            editedAt: null
          }
        ]
      })
    })
    await waitFor(() =>
      expect(
        screen.getByText('Daily, weekly, 1:1, mensal e retro de sprint · 1 salvo')
      ).toBeInTheDocument()
    )
  })

  it('gera resumo por template (sem IA) e não mostra pílula de provider', async () => {
    installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: '# Standup\n- fiz X', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('fiz X')).toBeInTheDocument())
    expect(screen.queryByText('Claude')).not.toBeInTheDocument()
    expect(screen.queryByText(/Gerado por template —/)).not.toBeInTheDocument()
  })

  it('gera resumo com IA e mostra a pílula do provider', async () => {
    const api = installMockApi(
      baseHandlers({
        'ai:status': () => aiStatusWithClaude as never,
        'summaries:generate': () => ({ markdown: '# Standup IA', generatedBy: 'claude' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('Claude')).toBeInTheDocument())
    expect(api.lastPayload('summaries:generate')).toMatchObject({
      template: 'standup',
      useClaude: true
    })
  })

  it('interruptor de IA desabilitado quando não há provider ativo', async () => {
    renderSummaries()
    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled())
  })

  it('desligar "usar IA" manda useClaude: false', async () => {
    const api = installMockApi(
      baseHandlers({
        'ai:status': () => aiStatusWithClaude as never,
        'summaries:generate': () => ({ markdown: '# sem ia', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(gerarButton())
    await waitFor(() => expect(api.count('summaries:generate')).toBe(1))
    expect(api.lastPayload('summaries:generate')).toMatchObject({ useClaude: false })
  })

  it('fallback: pediu IA mas veio de template — mostra aviso', async () => {
    installMockApi(
      baseHandlers({
        'ai:status': () => aiStatusWithClaude as never,
        'summaries:generate': () => ({ markdown: '# Standup', generatedBy: 'template' })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())
    await userEvent.click(gerarButton())
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
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('conteúdo')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(api.count('summaries:save')).toBe(1))
    expect(api.lastPayload('summaries:save')).toMatchObject({
      template: 'standup',
      contentMd: '# conteúdo',
      generatedBy: 'template'
    })
  })

  it('edita o resumo antes de copiar', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: 'rascunho', generatedBy: 'template' }),
        'export:clipboard': () => ({ ok: true })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('rascunho')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const textarea = screen.getByLabelText('Conteúdo do resumo')
    await userEvent.type(textarea, ' revisado')
    await userEvent.click(screen.getByRole('button', { name: 'Pronto' }))

    await waitFor(() => expect(screen.getByText('rascunho revisado')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(api.lastPayload('export:clipboard')).toEqual({ text: 'rascunho revisado' })
  })

  it('trilho de salvos: pílula do tipo, carrega no editor, copia e exclui', async () => {
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
        'summaries:delete': () => ({ ok: true }),
        'export:clipboard': () => ({ ok: true })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByTitle('Carregar no editor')).toBeInTheDocument())
    // "Weekly" também é uma opção do segmented — a pílula é a que tem raio total
    const pill = screen.getAllByText('Weekly').find((el) => el.className.includes('rounded-full'))
    expect(pill).toBeDefined()
    expect(screen.getByText('8 de janeiro')).toBeInTheDocument()

    await userEvent.click(screen.getByTitle('Copiar resumo salvo'))
    await waitFor(() => expect(api.count('export:clipboard')).toBe(1))

    await userEvent.click(screen.getByTitle('Carregar no editor'))
    await waitFor(() => expect(screen.getByText('Resumo semanal salvo')).toBeInTheDocument())

    await userEvent.click(screen.getByTitle('Excluir'))
    await waitFor(() => expect(api.count('summaries:delete')).toBe(1))
    expect(api.lastPayload('summaries:delete')).toEqual({ id: 7 })
  })

  it('histórico vazio vira linha, não cartão (regra 3)', async () => {
    renderSummaries()
    await waitFor(() => expect(screen.getByText('Salvos 0')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Salvos' })).not.toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Retro de sprint' }))

    // sprint fechada mais recente é o default
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sprint' })).toHaveValue('10'))

    await userEvent.click(gerarButton())
    await waitFor(() => expect(api.count('summaries:sprintRetro')).toBe(1))
    expect(api.lastPayload('summaries:sprintRetro')).toMatchObject({ sprintJiraId: 10 })
  })

  it('sem sprints, botão de gerar fica desabilitado no modo retro', async () => {
    renderSummaries()
    await userEvent.click(screen.getByRole('button', { name: 'Retro de sprint' }))
    await waitFor(() => expect(screen.getByText('Nenhuma sprint encontrada')).toBeInTheDocument())
    expect(gerarButton()).toBeDisabled()
  })

  it('copia o resumo para a área de transferência', async () => {
    const api = installMockApi(
      baseHandlers({
        'summaries:generate': () => ({ markdown: 'conteúdo copiável', generatedBy: 'template' }),
        'export:clipboard': () => ({ ok: true })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('conteúdo copiável')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))
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
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('conteúdo export')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: '.md' }))
    await waitFor(() => expect(api.count('export:file')).toBe(1))
    expect(api.lastPayload('export:file')).toMatchObject({ content: 'conteúdo export' })
  })

  it('keys de card no corpo do resumo abrem a gaveta', async () => {
    const openIssue = vi.fn()
    installMockApi(
      baseHandlers({
        'summaries:generate': () => ({
          markdown: 'Trabalhei em BT-123 e também em **BT-456**.',
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
    await userEvent.click(gerarButton())
    await waitFor(() => expect(screen.getByText('BT-123')).toBeInTheDocument())
    expect(screen.getByText('BT-456')).toBeInTheDocument()

    await userEvent.click(screen.getByText('BT-123'))
    expect(openIssue).toHaveBeenCalledWith('BT-123')
  })

  it('corpo do resumo renderiza títulos e listas do markdown', async () => {
    installMockApi(
      baseHandlers({
        'summaries:generate': () => ({
          markdown: '## Ontem\n- terminei o relatório\n\nHoje começo a migração.',
          generatedBy: 'template'
        })
      })
    )
    renderWithProviders(<Summaries />, { withIssueDetail: false })
    await userEvent.click(gerarButton())

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ontem' })).toBeInTheDocument())
    expect(screen.getByRole('listitem')).toHaveTextContent('terminei o relatório')
    expect(screen.getByText('Hoje começo a migração.')).toBeInTheDocument()
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

      await userEvent.click(screen.getByRole('button', { name: 'Gerar tabela' }))
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
      await userEvent.click(screen.getByRole('button', { name: 'Gerar tabela' }))
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
      await userEvent.click(screen.getByRole('button', { name: 'Gerar tabela' }))
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

      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Período dos worklogs' }),
        'Mês passado'
      )

      await userEvent.click(screen.getByRole('button', { name: 'Gerar tabela' }))
      await waitFor(() => expect(api.count('worklog:export')).toBe(1))
      const payload = api.lastPayload('worklog:export') as { start: string; end: string }
      expect(payload.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(payload.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })
})
