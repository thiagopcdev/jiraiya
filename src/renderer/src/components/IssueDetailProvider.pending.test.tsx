// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, OpenIssueButton } from './IssueDetailProvider.testUtils'

/**
 * Bloco "Aguardando sincronização": ações da fila offline específicas do card
 * aberto, e a atualização via push:queue-changed.
 */

afterEach(cleanup)

async function openCard(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
  await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
}

describe('IssueDetailProvider — bloco de ações pendentes', () => {
  it('não mostra o bloco quando não há ações pendentes para o card', async () => {
    installMockApi({ ...baseHandlers(), 'queue:list': () => ({ actions: [] }) })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(screen.queryByText('Aguardando sincronização')).not.toBeInTheDocument()
  })

  it('mostra ações pendentes do card com o rótulo de status correto', async () => {
    installMockApi({
      ...baseHandlers(),
      'queue:list': () => ({
        actions: [
          {
            id: 1,
            issueKey: 'BT-1',
            type: 'comment',
            summary: 'Comentar: "Feito"',
            status: 'pending',
            attempts: 0,
            lastError: null,
            createdAt: '2026-07-01T10:00:00.000Z'
          },
          {
            id: 2,
            issueKey: 'BT-1',
            type: 'transition',
            summary: 'Mover para Em andamento',
            status: 'inflight',
            attempts: 1,
            lastError: null,
            createdAt: '2026-07-01T10:01:00.000Z'
          },
          {
            id: 3,
            issueKey: 'BT-1',
            type: 'worklog',
            summary: 'Apontar 1h',
            status: 'failed',
            attempts: 3,
            lastError: 'Erro de rede',
            createdAt: '2026-07-01T10:02:00.000Z'
          },
          // ação de outro card: não deve aparecer na gaveta do BT-1
          {
            id: 4,
            issueKey: 'BT-9',
            type: 'comment',
            summary: 'Comentar em outro card',
            status: 'pending',
            attempts: 0,
            lastError: null,
            createdAt: '2026-07-01T10:03:00.000Z'
          }
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Aguardando sincronização')).toBeInTheDocument())
    expect(screen.getByText('Comentar: "Feito"')).toBeInTheDocument()
    expect(screen.getByText('pendente')).toBeInTheDocument()
    expect(screen.getByText('Mover para Em andamento')).toBeInTheDocument()
    expect(screen.getByText('enviando…')).toBeInTheDocument()
    expect(screen.getByText('Apontar 1h')).toBeInTheDocument()
    expect(screen.getByText('falhou')).toBeInTheDocument()
    expect(screen.queryByText('Comentar em outro card')).not.toBeInTheDocument()
  })

  it('push:queue-changed invalida a fila e atualiza o bloco', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'queue:list': () => ({ actions: [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(screen.queryByText('Aguardando sincronização')).not.toBeInTheDocument()

    api.set('queue:list', () => ({
      actions: [
        {
          id: 5,
          issueKey: 'BT-1',
          type: 'update',
          summary: 'Atualizar campos',
          status: 'pending',
          attempts: 0,
          lastError: null,
          createdAt: '2026-07-01T10:05:00.000Z'
        }
      ]
    }))
    api.push('push:queue-changed', { pending: 1, failed: 0 })

    await waitFor(() => expect(screen.getByText('Aguardando sincronização')).toBeInTheDocument())
    expect(screen.getByText('Atualizar campos')).toBeInTheDocument()
  })
})
