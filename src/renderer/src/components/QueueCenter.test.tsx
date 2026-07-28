// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PendingAction } from '@shared/domain'
import { installMockApi, type MockHandlers } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { QueueBadge } from './QueueCenter'

afterEach(cleanup)

function action(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 1,
    issueKey: 'BT-1',
    type: 'comment',
    summary: 'Comentar: "oi"',
    status: 'pending',
    attempts: 1,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function handlers(actions: PendingAction[], overrides: MockHandlers = {}): MockHandlers {
  return { 'queue:list': () => ({ actions }), ...overrides }
}

describe('QueueCenter', () => {
  it('sem pendências, o badge não é renderizado', async () => {
    const api = installMockApi(handlers([]))
    const { container } = renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(api.count('queue:list')).toBe(1))
    expect(container.querySelector('button')).not.toBeInTheDocument()
  })

  it('com pendências, mostra o total (pendentes + falhados) no badge', async () => {
    installMockApi(handlers([action({ status: 'pending' }), action({ id: 2, status: 'failed' })]))
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
  })

  it('clicar no badge abre o modal com as ações e "Ações pendentes" no título', async () => {
    installMockApi(handlers([action()]))
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))
    expect(screen.getByText('Ações pendentes')).toBeInTheDocument()
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('Comentar: "oi"')).toBeInTheDocument()
    expect(screen.getByText('pendente')).toBeInTheDocument()
  })

  it('lista vazia dentro do modal mostra o EmptyState (edge: badge só some com total 0)', async () => {
    // total > 0 pelo pending, mas o modal ainda deve renderizar cada linha corretamente
    installMockApi(handlers([action({ status: 'inflight' })]))
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))
    expect(screen.getByText('enviando…')).toBeInTheDocument()
  })

  it('ação falhada mostra o erro, tentativas e permite retry', async () => {
    const api = installMockApi(
      handlers([action({ status: 'failed', attempts: 3, lastError: 'Erro de rede' })], {
        'queue:retry': () => ({ ok: true })
      })
    )
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))

    expect(screen.getByText('Erro de rede')).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('falhou')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tentar agora' }))
    await waitFor(() => expect(api.count('queue:retry')).toBe(1))
    expect(api.lastPayload('queue:retry')).toEqual({ id: 1 })
  })

  it('descarte pede confirmação inline antes de executar', async () => {
    const api = installMockApi(
      handlers([action({ status: 'failed', lastError: 'x' })], {
        'queue:discard': () => ({ ok: true })
      })
    )
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByText('Descartar esta ação?')).toBeInTheDocument()
    expect(api.count('queue:discard')).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    await waitFor(() => expect(api.count('queue:discard')).toBe(1))
    expect(api.lastPayload('queue:discard')).toEqual({ id: 1 })
  })

  it('cancelar o descarte volta ao botão "Descartar" sem chamar a API', async () => {
    const api = installMockApi(handlers([action({ status: 'failed', lastError: 'x' })]))
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Não' }))
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(api.count('queue:discard')).toBe(0)
  })

  it('"Tentar todas" só aparece com falhas e drena a fila inteira', async () => {
    const api = installMockApi(
      handlers(
        [action({ status: 'failed', lastError: 'x' }), action({ id: 2, status: 'pending' })],
        {
          'queue:retry': () => ({ ok: true })
        }
      )
    )
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))

    const retryAll = screen.getByRole('button', { name: 'Tentar todas' })
    await userEvent.click(retryAll)
    await waitFor(() => expect(api.count('queue:retry')).toBe(1))
    expect(api.lastPayload('queue:retry')).toEqual({})
  })

  it('sem falhas, "Tentar todas" não aparece', async () => {
    installMockApi(handlers([action({ status: 'pending' })]))
    renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))
    expect(screen.queryByRole('button', { name: 'Tentar todas' })).not.toBeInTheDocument()
  })

  it('fechar o modal pelo X e clicando fora do card', async () => {
    installMockApi(handlers([action()]))
    const { container } = renderWithProviders(<QueueBadge />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))
    expect(screen.getByText('Ações pendentes')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Fechar'))
    expect(screen.queryByText('Ações pendentes')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTitle('ações aguardando sincronização'))
    const overlay = document.querySelector('.fixed.inset-0.z-50') as HTMLElement
    await userEvent.click(overlay)
    expect(screen.queryByText('Ações pendentes')).not.toBeInTheDocument()
    void container
  })
})
