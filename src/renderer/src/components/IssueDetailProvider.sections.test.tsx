// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, makeIssue, OpenIssueButton } from './IssueDetailProvider.testUtils'

/**
 * Demais seções da gaveta: transição de status, lançamentos (worklogs) CRUD,
 * histórico (changelog) lazy, relacionados (pai/subtarefas/vínculos), seguir
 * card, timer do header, pull requests e copiar link/branch.
 */

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
})

async function openCard(issueKey = 'BT-1', summary = 'Corrigir bug no login'): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: `abrir ${issueKey}` }))
  await waitFor(() => expect(screen.getByText(summary)).toBeInTheDocument())
}

describe('IssueDetailProvider — transição de status', () => {
  it('move o card e mostra o ícone de sucesso', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:transitions': () => ({
        transitions: [
          {
            id: 't1',
            name: 'Iniciar',
            toStatusName: 'Em andamento',
            toCategoryKey: 'indeterminate'
          }
        ]
      }),
      'issues:transition': () => ({
        newStatus: 'Em andamento',
        newStatusCategory: 'indeterminate',
        queued: false
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const select = await screen.findByTitle('Mover para…')
    await userEvent.selectOptions(select, 't1')

    await waitFor(() => expect(api.count('issues:transition')).toBe(1))
    expect(api.lastPayload('issues:transition')).toEqual({
      key: 'BT-1',
      transitionId: 't1',
      toStatusName: 'Em andamento',
      toCategoryKey: 'indeterminate'
    })
    await waitFor(() => expect(screen.getByTitle('Movido!')).toBeInTheDocument())
  })

  it('transição enfileirada offline mostra o aviso da fila', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:transitions': () => ({
        transitions: [
          {
            id: 't1',
            name: 'Iniciar',
            toStatusName: 'Em andamento',
            toCategoryKey: 'indeterminate'
          }
        ]
      }),
      'issues:transition': () => ({
        newStatus: 'Em andamento',
        newStatusCategory: 'indeterminate',
        queued: true
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const select = await screen.findByTitle('Mover para…')
    await userEvent.selectOptions(select, 't1')

    await waitFor(() =>
      expect(
        screen.getByText('Sem rede — a ação ficou na fila e será enviada quando a conexão voltar.')
      ).toBeInTheDocument()
    )
  })
})

describe('IssueDetailProvider — lançamentos (worklogs)', () => {
  async function openWorklogsTab(): Promise<void> {
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Worklogs' }))
  }

  it('lista, edita e apaga um lançamento', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'worklog:list': () => ({
        worklogs: [
          {
            id: 'w1',
            authorName: 'Thiago Prado',
            authorAccountId: 'acc-me',
            isMine: true,
            started: '2026-07-01T10:00:00.000Z',
            timeSpent: '1h',
            timeSpentSeconds: 3600,
            comment: 'trabalho inicial'
          }
        ],
        totalTimeSpent: '1h'
      }),
      'worklog:update': () => ({ ok: true, totalTimeSpent: '2h' }),
      'worklog:delete': () => ({ ok: true, totalTimeSpent: '0h' })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openWorklogsTab()

    await waitFor(() => expect(screen.getByText('trabalho inicial')).toBeInTheDocument())
    expect(screen.getByText('Registrado: 1h')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Editar lançamento' }))
    const timeInput = screen.getByDisplayValue('1h')
    await userEvent.clear(timeInput)
    await userEvent.type(timeInput, '2h')
    const editRow = timeInput.closest('div.rounded-md') as HTMLElement
    await userEvent.click(within(editRow).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('worklog:update')).toBe(1))
    expect(api.lastPayload('worklog:update')).toEqual({
      key: 'BT-1',
      worklogId: 'w1',
      timeSpent: '2h',
      comment: 'trabalho inicial'
    })
    await waitFor(() => expect(screen.getByText('Registrado: 2h')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Apagar lançamento' }))
    expect(screen.getByText('Excluir?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))

    await waitFor(() => expect(api.count('worklog:delete')).toBe(1))
    expect(api.lastPayload('worklog:delete')).toEqual({ key: 'BT-1', worklogId: 'w1' })
  })

  it('sem lançamentos mostra o estado vazio', async () => {
    installMockApi({
      ...baseHandlers(),
      'worklog:list': () => ({ worklogs: [], totalTimeSpent: null })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openWorklogsTab()

    await waitFor(() => expect(screen.getByText('Nenhum lançamento ainda.')).toBeInTheDocument())
    expect(screen.getByText('Registrado: —')).toBeInTheDocument()
  })

  it('busca worklog:list só quando a aba abre', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'worklog:list': () => ({ worklogs: [], totalTimeSpent: null })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(api.count('worklog:list')).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Worklogs' }))
    await waitFor(() => expect(api.count('worklog:list')).toBe(1))
  })

  it('registra tempo trabalhado e atualiza o total exibido', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'worklog:list': () => ({ worklogs: [], totalTimeSpent: '1h' }),
      'issues:logWork': () => ({ ok: true, totalTimeSpent: '3h', queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openWorklogsTab()

    await waitFor(() => expect(screen.getByText('Registrado: 1h')).toBeInTheDocument())
    await userEvent.type(screen.getByPlaceholderText('1h 30m'), '2h')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(api.count('issues:logWork')).toBe(1))
    expect(api.lastPayload('issues:logWork')).toEqual({ key: 'BT-1', timeSpent: '2h' })
    // o total vem da resposta do IPC e vence o refetch da lista (que devolve 1h)
    await waitFor(() => expect(screen.getByText('Registrado: 3h')).toBeInTheDocument())
  })

  it('registro de tempo enfileirado offline mostra o aviso da fila', async () => {
    installMockApi({
      ...baseHandlers(),
      'worklog:list': () => ({ worklogs: [], totalTimeSpent: null }),
      'issues:logWork': () => ({ ok: true, totalTimeSpent: null, queued: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openWorklogsTab()

    await userEvent.type(screen.getByPlaceholderText('1h 30m'), '1h')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() =>
      expect(
        screen.getByText('Sem rede — a ação ficou na fila e será enviada quando a conexão voltar.')
      ).toBeInTheDocument()
    )
  })
})

describe('IssueDetailProvider — histórico (changelog)', () => {
  it('busca só ao abrir e lista as entradas', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:changelog': () => ({
        entries: [
          {
            id: 'ch1',
            authorName: 'Fulano',
            createdAt: '2026-07-01T09:00:00.000Z',
            items: [{ field: 'status', from: 'A fazer', to: 'Em andamento' }]
          }
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(api.count('issues:changelog')).toBe(0)
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }))

    await waitFor(() => expect(api.count('issues:changelog')).toBe(1))
    await waitFor(() => expect(screen.getByText('A fazer')).toBeInTheDocument())
    expect(screen.getByText('status')).toBeInTheDocument()
  })

  it('mostra erro quando o changelog falha', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:changelog': () => {
        throw new Error('offline')
      }
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }))

    await waitFor(() =>
      expect(
        screen.getByText('Não foi possível carregar o histórico (sem conexão?).')
      ).toBeInTheDocument()
    )
  })
})

describe('IssueDetailProvider — relacionados (pai/subtarefas/vínculos)', () => {
  it('abre o pai a partir do link "Pai"', async () => {
    const parent = makeIssue({ key: 'BT-1', summary: 'Card pai' })
    const child = makeIssue({ key: 'BT-2', summary: 'Card filho', parentKey: 'BT-1' })
    const issues: Record<string, ReturnType<typeof makeIssue>> = { 'BT-1': parent, 'BT-2': child }
    installMockApi({
      ...baseHandlers(),
      'issues:get': ({ key }) => ({ issue: issues[key] ?? null })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-2" />)
    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-2' }))
    await waitFor(() => expect(screen.getByText('Card filho')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Pai: BT-1' }))
    await waitFor(() => expect(screen.getByText('Card pai')).toBeInTheDocument())
  })

  it('cria uma subtarefa e navega até ela', async () => {
    const parent = makeIssue({ key: 'BT-1', summary: 'Card pai' })
    const created = makeIssue({ key: 'BT-3', summary: 'Nova subtarefa', parentKey: 'BT-1' })
    const issues: Record<string, ReturnType<typeof makeIssue>> = { 'BT-1': parent, 'BT-3': created }
    const api = installMockApi({
      ...baseHandlers(),
      'issues:get': ({ key }) => ({ issue: issues[key] ?? null }),
      'issueTypes:list': () => ({ issueTypes: [{ id: 'sub1', name: 'Subtarefa', subtask: true }] }),
      'issues:create': () => ({ key: 'BT-3' }),
      'sync:run': () => ({ started: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard('BT-1', 'Card pai')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Subtarefa' })).toBeInTheDocument()
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Subtarefa' }))
    await userEvent.type(screen.getByPlaceholderText('Título da subtarefa…'), 'Nova subtarefa')
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }))

    await waitFor(() => expect(api.count('issues:create')).toBe(1))
    expect(api.lastPayload('issues:create')).toMatchObject({
      projectKey: 'BT',
      issueTypeId: 'sub1',
      summary: 'Nova subtarefa',
      assignToMe: true,
      parentKey: 'BT-1'
    })
    await waitFor(() => expect(screen.getByText('Nova subtarefa')).toBeInTheDocument())
  })

  it('cria um vínculo entre cards', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:linkTypes': () => ({
        types: [{ id: 'lt1', name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' }]
      }),
      'issues:search': () => ({ issues: [makeIssue({ key: 'BT-5', summary: 'Outro card' })] }),
      'issues:linkCreate': () => ({ ok: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: '+ Vincular' }))
    await userEvent.selectOptions(screen.getByDisplayValue('Tipo de vínculo'), 'Blocks|outward')
    await userEvent.type(screen.getByPlaceholderText('Buscar card por key ou título…'), 'BT-5')
    await waitFor(() => expect(screen.getByText(/BT-5 — Outro card/)).toBeInTheDocument())
    await userEvent.click(screen.getByText(/BT-5 — Outro card/))
    await userEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    await waitFor(() => expect(api.count('issues:linkCreate')).toBe(1))
    expect(api.lastPayload('issues:linkCreate')).toEqual({
      fromKey: 'BT-1',
      toKey: 'BT-5',
      typeName: 'Blocks',
      direction: 'outward'
    })
  })
})

describe('IssueDetailProvider — seguir card', () => {
  it('alterna seguir/deixar de seguir', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'watch:status': () => ({ watching: false }),
      'watch:toggle': () => ({ watching: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Seguir card' }))
    await waitFor(() => expect(api.count('watch:toggle')).toBe(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deixar de seguir' })).toBeInTheDocument()
    )
  })
})

describe('IssueDetailProvider — timer do header', () => {
  it('inicia, pausa e registra o tempo (some ao registrar)', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:logWork': () => ({ ok: true, totalTimeSpent: '1m', queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar timer' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pausar timer' })).toBeInTheDocument()
    )
    // precisa de >=1s de tempo acumulado real para `hasTime` continuar true após pausar
    await new Promise((resolve) => setTimeout(resolve, 1100))

    await userEvent.click(screen.getByRole('button', { name: 'Pausar timer' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retomar timer' })).toBeInTheDocument()
    )

    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(api.count('issues:logWork')).toBe(1))
    expect(api.lastPayload('issues:logWork')).toMatchObject({
      key: 'BT-1',
      comment: 'Registrado pelo timer do Jiraiya'
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Iniciar timer' })).toBeInTheDocument()
    )
  })

  it('rodando, o timer vira pílula preenchida de marca (indigo-600 + text-white)', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar timer' }))
    const pause = await screen.findByRole('button', { name: 'Pausar timer' })
    const pill = pause.parentElement as HTMLElement
    expect(pill.className).toContain('bg-indigo-600')
    expect(pill.className).toContain('text-white')

    // o timer é global (mesmo estado entre montagens): pausa antes de sair para
    // não vazar "rodando" para o próximo teste
    await userEvent.click(pause)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Iniciar timer' })).toBeInTheDocument()
    )
  })

  it('descarta o tempo acumulado com confirmação', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    installMockApi(baseHandlers())
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar timer' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pausar timer' })).toBeInTheDocument()
    )
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await userEvent.click(screen.getByRole('button', { name: 'Pausar timer' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retomar timer' })).toBeInTheDocument()
    )

    await userEvent.click(screen.getByTitle('Descartar tempo do timer'))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Iniciar timer' })).toBeInTheDocument()
    )
  })
})

describe('IssueDetailProvider — pull requests', () => {
  it('lista PRs do card quando a integração está habilitada', async () => {
    installMockApi({
      ...baseHandlers(),
      'prs:status': () => ({ ghAvailable: true, enabled: true }),
      'prs:forIssue': () => ({
        available: true,
        prs: [
          {
            repo: 'biudtech/biud-frontend',
            number: 42,
            title: 'Corrige bug do login',
            url: 'https://github.com/biudtech/biud-frontend/pull/42',
            state: 'open',
            isDraft: false,
            reviewDecision: 'APPROVED',
            checks: 'passing',
            updatedAt: '2026-07-01T10:00:00.000Z'
          }
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByRole('button', { name: /^PRs/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^PRs/ }))

    expect(screen.getByText(/Corrige bug do login/)).toBeInTheDocument()
    expect(screen.getByText('aberto')).toBeInTheDocument()
    expect(screen.getByText('aprovado')).toBeInTheDocument()
  })

  it('não mostra a aba quando a integração está desabilitada', async () => {
    installMockApi({
      ...baseHandlers(),
      'prs:status': () => ({ ghAvailable: false, enabled: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Comentários')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^PRs/ })).not.toBeInTheDocument()
  })

  it('não mostra a aba quando a integração está ligada mas o card não tem PR', async () => {
    installMockApi({
      ...baseHandlers(),
      'prs:status': () => ({ ghAvailable: true, enabled: true }),
      'prs:forIssue': () => ({ available: true, prs: [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Comentários')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^PRs/ })).not.toBeInTheDocument()
  })
})

describe('IssueDetailProvider — compartilhar e copiar branch', () => {
  it('copia o link do card', async () => {
    const api = installMockApi(baseHandlers())
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Copiar link do card' }))
    await waitFor(() => expect(api.count('export:clipboard')).toBe(1))
    expect(api.lastPayload('export:clipboard')).toEqual({
      text: 'https://biudtecnologia.atlassian.net/browse/BT-1'
    })
  })

  it('copia o nome do branch derivado do card', async () => {
    const api = installMockApi(
      baseHandlers(makeIssue({ issueType: 'Bug', summary: '[Login] Não autentica' }))
    )
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard('BT-1', '[Login] Não autentica')

    await userEvent.click(screen.getByRole('button', { name: 'Copiar nome do branch' }))
    await waitFor(() => expect(api.count('export:clipboard')).toBe(1))
    expect(api.lastPayload('export:clipboard')).toEqual({ text: 'fix/BT-1-nao-autentica' })
  })
})
