// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import CommandPalette from './CommandPalette'

afterEach(cleanup)

/** Resultado padrão de search:global usado na maioria dos testes de busca. */
type SearchResult = {
  key: string
  summary: string
  status: string | null
  statusCategory: 'new' | 'indeterminate' | 'done' | null
  url: string
  snippet: string | null
  match: 'title' | 'description' | 'comment'
}

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    key: 'BT-806',
    summary: 'Corrigir bug no login',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    url: 'https://x.atlassian.net/browse/BT-806',
    snippet: 'texto com 「login」 destacado',
    match: 'title',
    ...overrides
  }
}

describe('CommandPalette', () => {
  it('fica fechado até ⌘K e alterna com o mesmo atalho', async () => {
    installMockApi()
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })

    expect(screen.queryByPlaceholderText(/Buscar card por key/)).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText(/Buscar card por key/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByPlaceholderText(/Buscar card por key/)).not.toBeInTheDocument()
  })

  it('Escape fecha o modal', () => {
    installMockApi()
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText(/Buscar card por key/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/Buscar card por key/)).not.toBeInTheDocument()
  })

  it('estado vazio mostra a dica e o hint de ações', () => {
    installMockApi()
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(screen.getByText(/Busque por título, descrição ou comentários/)).toBeInTheDocument()
    expect(screen.getByText(/abre a criação de card/)).toBeInTheDocument()
  })

  it('menos de 2 caracteres mostra aviso de mínimo, sem disparar busca', async () => {
    const api = installMockApi()
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'a')
    expect(screen.getByText('Digite ao menos 2 caracteres para buscar.')).toBeInTheDocument()
    expect(api.count('search:global')).toBe(0)
  })

  it('busca resultados, destaca snippet e mostra badge de status', async () => {
    installMockApi({
      'search:global': () => ({ results: [searchResult()] })
    })
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'login')

    await waitFor(() => expect(screen.getByText('BT-806')).toBeInTheDocument())
    expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument()
    expect(screen.getByText('Em andamento')).toBeInTheDocument()
    expect(screen.getByText('login')).toBeInTheDocument()
    expect(
      screen.getByText((_, node) => node?.textContent === 'texto com login destacado')
    ).toBeInTheDocument()
    expect(screen.getByText('↵ abrir · ⌘↵ abrir no Jira')).toBeInTheDocument()
  })

  it('sem resultados mostra "Nada encontrado."', async () => {
    installMockApi({ 'search:global': () => ({ results: [] }) })
    renderWithProviders(<CommandPalette />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'zzz')
    await waitFor(() => expect(screen.getByText('Nada encontrado.')).toBeInTheDocument())
  })

  it('↓/Enter abre o card selecionado na gaveta e fecha o modal', async () => {
    const openIssue = vi.fn()
    installMockApi({ 'search:global': () => ({ results: [searchResult()] }) })
    ;(window as unknown as { __openIssueSpy?: unknown }).__openIssueSpy = openIssue

    const { IssueDetailContext } = await import('./issueDetail')
    renderWithProviders(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <CommandPalette />
      </IssueDetailContext.Provider>,
      { withIssueDetail: false }
    )
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = screen.getByPlaceholderText(/Buscar card por key/)
    await userEvent.type(input, 'login')
    await waitFor(() => expect(screen.getByText('BT-806')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(openIssue).toHaveBeenCalledWith('BT-806')
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Buscar card por key/)).not.toBeInTheDocument()
    )
  })

  it('⌘Enter abre no Jira (shell:openIssue) em vez da gaveta', async () => {
    const openIssue = vi.fn()
    const api = installMockApi({
      'search:global': () => ({ results: [searchResult()] }),
      'shell:openIssue': () => ({ ok: true })
    })
    const { IssueDetailContext } = await import('./issueDetail')
    renderWithProviders(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <CommandPalette />
      </IssueDetailContext.Provider>,
      { withIssueDetail: false }
    )
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = screen.getByPlaceholderText(/Buscar card por key/)
    await userEvent.type(input, 'login')
    await waitFor(() => expect(screen.getByText('BT-806')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    expect(openIssue).not.toHaveBeenCalled()
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-806' })
  })

  it('clicar num resultado abre a gaveta', async () => {
    const openIssue = vi.fn()
    installMockApi({ 'search:global': () => ({ results: [searchResult()] }) })
    const { IssueDetailContext } = await import('./issueDetail')
    renderWithProviders(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <CommandPalette />
      </IssueDetailContext.Provider>,
      { withIssueDetail: false }
    )
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'login')
    await waitFor(() => expect(screen.getByText('BT-806')).toBeInTheDocument())
    await userEvent.click(screen.getByText('BT-806'))
    expect(openIssue).toHaveBeenCalledWith('BT-806')
  })

  describe('fluxo "criar <ideia>"', () => {
    it('sem ideia mostra o placeholder', async () => {
      installMockApi()
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'criar ')
      expect(screen.getByText('Digite a ideia do card…')).toBeInTheDocument()
    })

    it('com ideia mostra botão e Enter navega para /criar', async () => {
      installMockApi()
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      const input = screen.getByPlaceholderText(/Buscar card por key/)
      await userEvent.type(input, 'criar melhorar onboarding')
      expect(screen.getByText('Criar card: "melhorar onboarding"')).toBeInTheDocument()

      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() =>
        expect(screen.queryByPlaceholderText(/Buscar card por key/)).not.toBeInTheDocument()
      )
    })

    it('atalho ">ideia" também funciona', async () => {
      installMockApi()
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), '>corrigir X')
      expect(screen.getByText('Criar card: "corrigir X"')).toBeInTheDocument()
    })
  })

  describe('verbo parcial (dica de sintaxe)', () => {
    it.each(['mover', 'atribuir', 'apontar', 'comentar'])(
      'mostra sintaxe e exemplo para "%s" incompleto',
      async (verb) => {
        installMockApi()
        renderWithProviders(<CommandPalette />, { withIssueDetail: false })
        fireEvent.keyDown(window, { key: 'k', metaKey: true })
        await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), verb)
        expect(screen.getByText(new RegExp(`^${verb}`))).toBeInTheDocument()
        expect(screen.getByText(/ex\.:/)).toBeInTheDocument()
      }
    )
  })

  describe('ação rápida: mover', () => {
    it('lista candidatos filtrados, navega e executa (sem fila)', async () => {
      const api = installMockApi({
        'issues:transitions': () => ({
          transitions: [
            {
              id: '1',
              name: 'Ir para revisão',
              toStatusName: 'Em revisão',
              toCategoryKey: 'indeterminate'
            },
            { id: '2', name: 'Ir para feito', toStatusName: 'Concluído', toCategoryKey: 'done' }
          ]
        }),
        'issues:transition': () => ({
          newStatus: 'Em revisão',
          newStatusCategory: 'indeterminate',
          queued: false
        })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      const input = screen.getByPlaceholderText(/Buscar card por key/)
      await userEvent.type(input, 'mover BT-806 revi')

      await waitFor(() => expect(screen.getByText('Em revisão')).toBeInTheDocument())
      expect(screen.queryByText('Concluído')).not.toBeInTheDocument()
      expect(screen.getByText('Mover')).toBeInTheDocument()
      expect(screen.getByText('BT-806')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText('Feito!')).toBeInTheDocument())
      expect(api.lastPayload('issues:transition')).toEqual({
        key: 'BT-806',
        transitionId: '1',
        toStatusName: 'Em revisão',
        toCategoryKey: 'indeterminate'
      })
    })

    it('sem status compatível mostra aviso', async () => {
      installMockApi({ 'issues:transitions': () => ({ transitions: [] }) })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'mover BT-806 xyz')
      await waitFor(() => expect(screen.getByText('Nenhum status compatível.')).toBeInTheDocument())
    })

    it('execução enfileirada mostra aviso "sem rede"', async () => {
      installMockApi({
        'issues:transitions': () => ({
          transitions: [
            { id: '1', name: 'x', toStatusName: 'Em revisão', toCategoryKey: 'indeterminate' }
          ]
        }),
        'issues:transition': () => ({
          newStatus: 'Em revisão',
          newStatusCategory: 'indeterminate',
          queued: true
        })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'mover BT-806 rev')
      await waitFor(() => expect(screen.getByText('Em revisão')).toBeInTheDocument())
      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() =>
        expect(screen.getByText('Sem rede — ação enfileirada.')).toBeInTheDocument()
      )
    })

    it('erro na execução mostra a mensagem de falha', async () => {
      const { MockIpcFailure } = await import('../testing/mockApi')
      installMockApi({
        'issues:transitions': () => ({
          transitions: [
            { id: '1', name: 'x', toStatusName: 'Em revisão', toCategoryKey: 'indeterminate' }
          ]
        }),
        'issues:transition': () => {
          throw new MockIpcFailure('BOOM', 'Falha ao mover o card.')
        }
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'mover BT-806 rev')
      await waitFor(() => expect(screen.getByText('Em revisão')).toBeInTheDocument())
      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText('Falha ao mover o card.')).toBeInTheDocument())
    })

    it('clique num candidato também executa a ação', async () => {
      const api = installMockApi({
        'issues:transitions': () => ({
          transitions: [
            { id: '1', name: 'x', toStatusName: 'Em revisão', toCategoryKey: 'indeterminate' }
          ]
        }),
        'issues:transition': () => ({
          newStatus: 'Em revisão',
          newStatusCategory: 'indeterminate',
          queued: false
        })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(screen.getByPlaceholderText(/Buscar card por key/), 'mover BT-806 rev')
      await waitFor(() => expect(screen.getByText('Em revisão')).toBeInTheDocument())
      await userEvent.click(screen.getByText('Em revisão'))
      await waitFor(() => expect(api.count('issues:transition')).toBe(1))
    })
  })

  describe('ação rápida: atribuir', () => {
    it('"mim" usa auth:status e executa sem buscar assignable', async () => {
      const api = installMockApi({
        'auth:status': () => ({
          connected: true,
          workspace: {
            id: 1,
            accountId: 'acc-1',
            displayName: 'Fulano',
            email: 'f@x.com',
            siteUrl: '',
            timeZone: null
          }
        }),
        'issues:update': () => ({ ok: true, queued: false })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      // muda o valor inteiro de uma vez (digitar tecla a tecla passaria por estados
      // intermediários sem "mim" completo, que disparariam issues:assignable à toa)
      fireEvent.change(screen.getByPlaceholderText(/Buscar card por key/), {
        target: { value: 'atribuir BT-806 mim' }
      })
      await waitFor(() => expect(screen.getByText('Fulano')).toBeInTheDocument())
      expect(api.count('issues:assignable')).toBe(0)

      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText('Feito!')).toBeInTheDocument())
      expect(api.lastPayload('issues:update')).toEqual({
        key: 'BT-806',
        assigneeAccountId: 'acc-1',
        assigneeName: 'Fulano'
      })
    })

    it('sem usuário logado mostra "Pessoa não encontrada."', async () => {
      installMockApi({
        'auth:status': () => ({ connected: false, workspace: null })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar card por key/),
        'atribuir BT-806 mim'
      )
      await waitFor(() => expect(screen.getByText('Pessoa não encontrada.')).toBeInTheDocument())
    })

    it('busca por nome filtra assignable e executa', async () => {
      const api = installMockApi({
        'auth:status': () => ({ connected: true, workspace: null }),
        'issues:assignable': () => ({
          users: [
            { accountId: 'a1', displayName: 'Ana Souza' },
            { accountId: 'a2', displayName: 'Bruno Lima' }
          ]
        }),
        'issues:update': () => ({ ok: true, queued: false })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar card por key/),
        'atribuir BT-806 ana'
      )
      await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
      expect(screen.queryByText('Bruno Lima')).not.toBeInTheDocument()

      await userEvent.click(screen.getByText('Ana Souza'))
      expect(api.lastPayload('issues:update')).toEqual({
        key: 'BT-806',
        assigneeAccountId: 'a1',
        assigneeName: 'Ana Souza'
      })
    })

    it('sem candidato compatível mostra "Pessoa não encontrada."', async () => {
      installMockApi({
        'auth:status': () => ({ connected: true, workspace: null }),
        'issues:assignable': () => ({ users: [{ accountId: 'a1', displayName: 'Ana Souza' }] })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar card por key/),
        'atribuir BT-806 zzz'
      )
      await waitFor(() => expect(screen.getByText('Pessoa não encontrada.')).toBeInTheDocument())
    })
  })

  describe('ação rápida: apontar (worklog)', () => {
    it('mostra resumo e executa issues:logWork', async () => {
      const api = installMockApi({
        'issues:logWork': () => ({ ok: true, totalTimeSpent: '2h', queued: false })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar card por key/),
        'apontar 1h30m BT-806 revisão'
      )
      await waitFor(() => expect(screen.getByText(/Apontar 1h 30m em BT-806/)).toBeInTheDocument())
      fireEvent.keyDown(window, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText('Feito!')).toBeInTheDocument())
      expect(api.lastPayload('issues:logWork')).toEqual({
        key: 'BT-806',
        timeSpent: '1h 30m',
        comment: 'revisão'
      })
    })
  })

  describe('ação rápida: comentar', () => {
    it('mostra resumo e executa issues:comment', async () => {
      const api = installMockApi({
        'issues:comment': () => ({ ok: true, queued: false })
      })
      renderWithProviders(<CommandPalette />, { withIssueDetail: false })
      fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await userEvent.type(
        screen.getByPlaceholderText(/Buscar card por key/),
        'comentar BT-806 subiu pra homolog'
      )
      await waitFor(() => expect(screen.getByText(/subiu pra homolog/)).toBeInTheDocument())
      const button = screen.getByRole('button', { name: /Comentar em BT-806/ })
      await userEvent.click(button)
      await waitFor(() => expect(screen.getByText('Feito!')).toBeInTheDocument())
      expect(api.lastPayload('issues:comment')).toEqual({
        issueKey: 'BT-806',
        body: 'subiu pra homolog'
      })
    })
  })
})
