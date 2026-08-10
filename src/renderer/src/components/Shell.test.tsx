// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, type MockHandlers } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import Shell from './Shell'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function baseHandlers(overrides: MockHandlers = {}): MockHandlers {
  return {
    'sync:status': () => ({ running: false, lastSuccessAt: null, lastError: null, progress: null }),
    'alerts:list': () => ({ alerts: [] }),
    'mentions:list': () => ({ mentions: [], unreadCount: 0 }),
    'update:check': () => ({
      current: '2.1.0',
      latest: null,
      url: null,
      available: false,
      tokenConfigured: true,
      error: null
    }),
    'queue:list': () => ({ actions: [] }),
    'projects:list': () => ({ projects: [] }),
    'sprint:list': () => ({ sprints: [] }),
    ...overrides
  }
}

/** Recolhe o trilho e espera o ícone do app aparecer no lugar do wordmark. */
async function collapse(): Promise<void> {
  await userEvent.keyboard('{Meta>}b{/Meta}')
  await waitFor(() => expect(screen.getByRole('img', { name: 'Jiraiya' })).toBeInTheDocument())
}

describe('Shell', () => {
  it('renderiza o nome do app e os itens de navegação', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    expect(screen.getByText('Jiraiya')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Quadro')).toBeInTheDocument()
    expect(screen.getByText('Resumos')).toBeInTheDocument()
  })

  it('agrupa a nav em Entradas e Ferramentas, com os pares mesclados', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    expect(screen.getByText('Entradas')).toBeInTheDocument()
    expect(screen.getByText('Ferramentas')).toBeInTheDocument()
    expect(screen.getByText('Criar · Dividir')).toBeInTheDocument()
    expect(screen.getByText('Filtros · Timeline')).toBeInTheDocument()
    // os pares não deixam para trás os itens antigos separados
    expect(screen.queryByText('Criar task')).not.toBeInTheDocument()
    expect(screen.queryByText('Dividir task')).not.toBeInTheDocument()
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument()
  })

  it('Configurações sai da lista e vira ícone do rodapé, apontando para /config', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    const link = screen.getByRole('link', { name: 'Configurações' })
    expect(link).toHaveAttribute('href', '/config')
    // não é mais um item de "Ferramentas"
    expect(screen.queryByText('Configurações')).not.toBeInTheDocument()
  })

  it('o ícone de Configurações fica ativo em /config', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />, { route: '/config' })
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('"Criar · Dividir" fica ativo tanto em /criar quanto em /dividir', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />, { route: '/dividir' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Criar · Dividir/ })).toHaveAttribute(
        'aria-current',
        'page'
      )
    )
  })

  it('"Filtros · Timeline" fica ativo tanto em /filtros quanto em /timeline', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />, { route: '/timeline' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Filtros · Timeline/ })).toHaveAttribute(
        'aria-current',
        'page'
      )
    )
  })

  it('"Criar · Dividir" não fica ativo em outra rota', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />, { route: '/quadro' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Criar · Dividir/ })).not.toHaveAttribute(
        'aria-current'
      )
    )
  })

  it('mostra badge de alertas só quando há alertas', async () => {
    installMockApi(
      baseHandlers({
        'alerts:list': () => ({
          alerts: [
            {
              id: 1,
              ruleId: 'x',
              issueKey: 'BT-1',
              severity: 'critical',
              message: 'x',
              firstDetectedAt: '2026-01-01',
              lastSeenAt: '2026-01-01'
            }
          ]
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('sem alertas não mostra badge numérico ao lado de Alertas', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Alertas')).toBeInTheDocument())
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('mostra badge de menções não lidas', async () => {
    installMockApi(baseHandlers({ 'mentions:list': () => ({ mentions: [], unreadCount: 3 }) }))
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
  })

  it('mostra o projeto acompanhado e a sprint ativa abaixo do wordmark', async () => {
    installMockApi(
      baseHandlers({
        'projects:list': () => ({
          projects: [
            { jiraId: '1', key: 'BT', name: 'Bitcap', avatarUrl: null, selected: true },
            { jiraId: '2', key: 'XX', name: 'Outro', avatarUrl: null, selected: false }
          ]
        }),
        'sprint:list': () => ({
          sprints: [
            {
              jiraId: 9,
              name: 'Sprint 47',
              state: 'active',
              startDate: '2026-01-01',
              endDate: null
            },
            {
              jiraId: 8,
              name: 'Sprint 46',
              state: 'closed',
              startDate: '2025-12-01',
              endDate: '2025-12-15'
            }
          ]
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Bitcap · Sprint 47')).toBeInTheDocument())
  })

  it('com vários projetos selecionados, resume a contagem', async () => {
    installMockApi(
      baseHandlers({
        'projects:list': () => ({
          projects: [
            { jiraId: '1', key: 'BT', name: 'Bitcap', avatarUrl: null, selected: true },
            { jiraId: '2', key: 'XX', name: 'Outro', avatarUrl: null, selected: true }
          ]
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('2 projetos')).toBeInTheDocument())
  })

  it('o campo de busca dispara o mesmo evento do command palette', async () => {
    installMockApi(baseHandlers())
    const spy = vi.fn()
    window.addEventListener('jiraiya:open-palette', spy)
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: /Buscar/ }))
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener('jiraiya:open-palette', spy)
  })

  it('clicar no status de sync dispara sync:run', async () => {
    const api = installMockApi(baseHandlers({ 'sync:run': () => ({ started: true }) }))
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'Sincronizar' }))
    expect(api.count('sync:run')).toBe(1)
  })

  it('enquanto sincroniza, mostra spinner com a fase no título e desabilita o botão', async () => {
    installMockApi(
      baseHandlers({
        'sync:status': () => ({
          running: true,
          lastSuccessAt: null,
          lastError: null,
          progress: { phase: 'issues', done: 1, total: null }
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Sincronizando…')).toBeInTheDocument())
    const button = screen.getByRole('button', { name: 'Sincronizando…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Buscando issues…')
  })

  it('mostra a última sincronização como tempo relativo, em dia', async () => {
    installMockApi(
      baseHandlers({
        'sync:status': () => ({
          running: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          progress: null
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('agora')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toHaveAttribute(
      'title',
      'Sincronizado agora'
    )
  })

  it('mostra erro de sincronização', async () => {
    installMockApi(
      baseHandlers({
        'sync:status': () => ({
          running: false,
          lastSuccessAt: null,
          lastError: 'timeout',
          progress: null
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Falha na sincronização')).toBeInTheDocument())
  })

  it('nunca sincronizado mostra a mensagem correspondente', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Nunca sincronizado')).toBeInTheDocument())
  })

  it('fila offline vira o número em âmbar no lugar do tempo relativo', async () => {
    installMockApi(
      baseHandlers({
        'sync:status': () => ({
          running: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
          progress: null
        }),
        'queue:list': () => ({
          actions: [
            {
              id: 1,
              issueKey: 'BT-1',
              type: 'comment',
              summary: 'Comentar: "oi"',
              status: 'pending',
              attempts: 1,
              lastError: null,
              createdAt: '2026-01-01T00:00:00.000Z'
            },
            {
              id: 2,
              issueKey: 'BT-2',
              type: 'comment',
              summary: 'Comentar: "oi"',
              status: 'failed',
              attempts: 3,
              lastError: 'x',
              createdAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('2 na fila')).toBeInTheDocument())
    expect(screen.getByTitle('ações aguardando sincronização')).toBeInTheDocument()
    expect(screen.queryByText('agora')).not.toBeInTheDocument()
  })

  it('push:update-available mostra o pill de atualização e o X dispensa', async () => {
    const api = installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    api.push('push:update-available', { version: '2.1.0', url: 'https://x/release' })
    await waitFor(() => expect(screen.getByText('v2.1.0 disponível')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('Dispensar'))
    expect(screen.queryByText('v2.1.0 disponível')).not.toBeInTheDocument()
  })

  it('update:check periódico também mostra o pill quando disponível', async () => {
    installMockApi(
      baseHandlers({
        'update:check': () => ({
          current: '2.1.0',
          latest: '3.0.0',
          url: 'https://x/release',
          available: true,
          tokenConfigured: true,
          error: null
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('v3.0.0 disponível')).toBeInTheDocument())
  })

  it('botão de atalhos do teclado abre o modal de ajuda (KeyboardShortcuts)', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: 'Atalhos do teclado' }))
    await waitFor(() => expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument())
  })
})

describe('Shell — trilho recolhível (M2)', () => {
  it('⌘B recolhe o trilho, troca o wordmark pelo ícone do app e persiste', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    expect(screen.getByText('Jiraiya')).toBeInTheDocument()

    await collapse()
    expect(screen.queryByText('Jiraiya')).not.toBeInTheDocument()
    expect(localStorage.getItem('jiraiya.navCollapsed')).toBe('1')
    // os itens continuam acessíveis, só que como ícones rotulados
    expect(screen.getByRole('link', { name: 'Quadro' })).toBeInTheDocument()
  })

  it('⌘B de novo devolve a nav aberta', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    await collapse()
    await userEvent.keyboard('{Meta>}b{/Meta}')
    await waitFor(() => expect(screen.getByText('Jiraiya')).toBeInTheDocument())
    expect(localStorage.getItem('jiraiya.navCollapsed')).toBe('0')
  })

  it('começa recolhido quando o localStorage diz que sim', async () => {
    localStorage.setItem('jiraiya.navCollapsed', '1')
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    expect(screen.getByRole('img', { name: 'Jiraiya' })).toBeInTheDocument()
    expect(screen.queryByText('Jiraiya')).not.toBeInTheDocument()
  })

  it('o crachá vira contagem no rótulo acessível do ícone', async () => {
    localStorage.setItem('jiraiya.navCollapsed', '1')
    installMockApi(baseHandlers({ 'mentions:list': () => ({ mentions: [], unreadCount: 3 }) }))
    renderWithProviders(<Shell />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Menções: 3' })).toBeInTheDocument()
    )
  })

  it('hover no trilho abre o painel flutuante e o Pin fixa a nav aberta', async () => {
    localStorage.setItem('jiraiya.navCollapsed', '1')
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)

    const rail = screen.getByRole('img', { name: 'Jiraiya' }).closest('aside')!
    await userEvent.hover(rail.parentElement!)
    const pin = await screen.findByRole(
      'button',
      { name: 'Fixar a barra lateral' },
      {
        timeout: 2000
      }
    )

    await userEvent.click(pin)
    await waitFor(() => expect(screen.getByText('Jiraiya')).toBeInTheDocument())
    expect(localStorage.getItem('jiraiya.navCollapsed')).toBe('0')
  })

  it('tirar o mouse fecha o painel flutuante', async () => {
    localStorage.setItem('jiraiya.navCollapsed', '1')
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)

    const rail = screen.getByRole('img', { name: 'Jiraiya' }).closest('aside')!
    await userEvent.hover(rail.parentElement!)
    await screen.findByRole('button', { name: 'Fixar a barra lateral' }, { timeout: 2000 })

    await userEvent.unhover(rail.parentElement!)
    await waitFor(
      () =>
        expect(
          screen.queryByRole('button', { name: 'Fixar a barra lateral' })
        ).not.toBeInTheDocument(),
      { timeout: 2000 }
    )
  })

  it('recolhido, a atualização disponível vira ícone de download', async () => {
    localStorage.setItem('jiraiya.navCollapsed', '1')
    const api = installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    api.push('push:update-available', { version: '2.1.0', url: 'https://x/release' })
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'v2.1.0 disponível' })).toHaveAttribute(
        'href',
        'https://x/release'
      )
    )
  })
})
