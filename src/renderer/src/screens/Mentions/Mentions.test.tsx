// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { Mention } from '@shared/domain'
import { installMockApi } from '../../testing/mockApi'
import { makeQueryClient, renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import Mentions from './Mentions'

function makeMention(overrides: Partial<Mention> = {}): Mention {
  return {
    id: 1,
    issueKey: 'BT-1',
    issueSummary: 'Ajustar layout',
    authorAccountId: 'acc-1',
    authorName: 'Fulano',
    excerpt: 'você pode olhar isso?',
    occurredAt: new Date().toISOString(),
    readAt: null,
    ...overrides
  }
}

describe('Mentions', () => {
  afterEach(() => cleanup())

  it('mostra o spinner enquanto carrega', () => {
    installMockApi({ 'mentions:list': () => new Promise(() => {}) })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renderiza o título via ScreenHeader', async () => {
    installMockApi({ 'mentions:list': () => ({ mentions: [], unreadCount: 0 }) })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Menções' })).toBeInTheDocument()
    )
  })

  it('estado vazio quando não há menções', async () => {
    installMockApi({ 'mentions:list': () => ({ mentions: [], unreadCount: 0 }) })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Nenhuma menção a você ainda.')).toBeInTheDocument()
    )
  })

  it('agrupa menções por dia e renderiza autor/resumo/trecho', async () => {
    installMockApi({
      'mentions:list': () => ({
        mentions: [makeMention({ id: 1, authorName: 'Fulano' })],
        unreadCount: 0
      })
    })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Hoje')).toBeInTheDocument())
    expect(screen.getByText('Fulano')).toBeInTheDocument()
    expect(screen.getByText('mencionou você em')).toBeInTheDocument()
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('Ajustar layout')).toBeInTheDocument()
    expect(screen.getByText('você pode olhar isso?')).toBeInTheDocument()
  })

  it('menção sem autor cai no rótulo "Alguém"', async () => {
    installMockApi({
      'mentions:list': () => ({
        mentions: [makeMention({ authorName: null })],
        unreadCount: 0
      })
    })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Alguém')).toBeInTheDocument())
  })

  it('com unreadCount > 0, marca tudo como lido uma única vez', async () => {
    const api = installMockApi({
      'mentions:list': () => ({ mentions: [makeMention()], unreadCount: 2 }),
      'mentions:markAllRead': () => ({ ok: true })
    })
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() => expect(api.count('mentions:markAllRead')).toBe(1))
    expect(api.count('mentions:markAllRead')).toBe(1)
  })

  it('clicar no ícone externo chama shell:openIssue', async () => {
    const api = installMockApi({
      'mentions:list': () => ({ mentions: [makeMention()], unreadCount: 0 }),
      'shell:openIssue': () => ({ ok: true })
    })
    const user = userEvent.setup()
    renderWithProviders(<Mentions />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByTitle('Abrir BT-1 no Jira')).toBeInTheDocument())
    await user.click(screen.getByTitle('Abrir BT-1 no Jira'))
    expect(api.count('shell:openIssue')).toBe(1)
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-1' })
  })

  it('clicar na linha abre a gaveta com a key da menção', async () => {
    installMockApi({
      'mentions:list': () => ({ mentions: [makeMention()], unreadCount: 0 })
    })
    const openIssue = vi.fn()
    const user = userEvent.setup()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <Mentions />
        </IssueDetailContext.Provider>
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Fulano')).toBeInTheDocument())
    await user.click(screen.getByTitle('BT-1'))
    expect(openIssue).toHaveBeenCalledWith('BT-1')
  })
})
