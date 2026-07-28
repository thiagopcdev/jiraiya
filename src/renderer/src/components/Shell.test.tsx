// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, type MockHandlers } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import Shell from './Shell'

afterEach(cleanup)

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
    ...overrides
  }
}

describe('Shell', () => {
  it('renderiza o nome do app e os itens de navegação', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    expect(screen.getByText('Jiraiya')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Quadro')).toBeInTheDocument()
    expect(screen.getByText('Resumos')).toBeInTheDocument()
    expect(screen.getByText('Configurações')).toBeInTheDocument()
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

  it('clicar em Sincronizar dispara sync:run', async () => {
    const api = installMockApi(baseHandlers({ 'sync:run': () => ({ started: true }) }))
    renderWithProviders(<Shell />)
    await userEvent.click(screen.getByRole('button', { name: /Sincronizar/ }))
    expect(api.count('sync:run')).toBe(1)
  })

  it('enquanto sincroniza, mostra spinner e desabilita o botão', async () => {
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
    expect(screen.getByRole('button', { name: /Sincronizando/ })).toBeDisabled()
    expect(screen.getByText('Buscando issues…')).toBeInTheDocument()
  })

  it('mostra a última sincronização com sucesso', async () => {
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
    await waitFor(() => expect(screen.getByText(/Sincronizado/)).toBeInTheDocument())
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
    await userEvent.click(screen.getByRole('button', { name: /Atalhos do teclado/ }))
    await waitFor(() => expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument())
  })

  it('badge da fila aparece quando há ações pendentes', async () => {
    installMockApi(
      baseHandlers({
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
            }
          ]
        })
      })
    )
    renderWithProviders(<Shell />)
    await waitFor(() =>
      expect(screen.getByTitle('ações aguardando sincronização')).toBeInTheDocument()
    )
  })

  it('sem pendências na fila, o badge não aparece', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<Shell />)
    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    expect(screen.queryByTitle('ações aguardando sincronização')).not.toBeInTheDocument()
  })
})
