// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CommandLogEntry } from '@shared/domain'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { CommandLogModal } from './CommandLogModal'

afterEach(cleanup)

function entry(overrides: Partial<CommandLogEntry> = {}): CommandLogEntry {
  return {
    id: 1,
    ts: '2026-01-01T10:00:00.000Z',
    kind: 'cli',
    provider: 'claude',
    feature: 'summaries',
    command: 'claude -p "resuma o card BT-1..." (prompt truncado)',
    durationMs: 1834,
    ok: true,
    error: null,
    ...overrides
  }
}

describe('CommandLogModal', () => {
  it('mostra spinner enquanto carrega', () => {
    installMockApi({ 'commandLog:list': () => new Promise(() => {}) })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    // o modal vai por portal pro body (gaveta tem transform) — busca fora do container do render
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('lista vazia mostra "Nenhum comando registrado."', async () => {
    installMockApi({ 'commandLog:list': () => ({ entries: [] }) })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Nenhum comando registrado.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Limpar histórico' })).toBeDisabled()
  })

  it('lista entradas com provider, feature e duração', async () => {
    installMockApi({
      'commandLog:list': () => ({
        entries: [entry(), entry({ id: 2, ok: false, error: 'Falhou de verdade', feature: null })]
      })
    })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getAllByText('claude')).toHaveLength(2))
    expect(screen.getByText('summaries')).toBeInTheDocument()
    expect(screen.getAllByText((_, el) => el?.textContent === '1.8s')).not.toHaveLength(0)
    expect(screen.getByText('Falhou de verdade')).toBeInTheDocument()
  })

  it('clicar no comando expande/recolhe o texto truncado', async () => {
    installMockApi({ 'commandLog:list': () => ({ entries: [entry()] }) })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    const cmdButton = await screen.findByTitle(entry().command)
    expect(cmdButton.className).toContain('truncate')

    await userEvent.click(cmdButton)
    expect(cmdButton.className).toContain('whitespace-pre-wrap')

    await userEvent.click(cmdButton)
    expect(cmdButton.className).toContain('truncate')
  })

  it('Limpar histórico pede confirmação e chama commandLog:clear', async () => {
    const api = installMockApi({
      'commandLog:list': () => ({ entries: [entry()] }),
      'commandLog:clear': () => ({ ok: true })
    })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    await screen.findByText('claude')

    await userEvent.click(screen.getByRole('button', { name: 'Limpar histórico' }))
    expect(screen.getByText('Limpar histórico?')).toBeInTheDocument()
    expect(api.count('commandLog:clear')).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    await waitFor(() => expect(api.count('commandLog:clear')).toBe(1))
  })

  it('cancelar a confirmação de limpar volta ao botão original', async () => {
    installMockApi({ 'commandLog:list': () => ({ entries: [entry()] }) })
    renderWithProviders(<CommandLogModal onClose={vi.fn()} />, { withIssueDetail: false })
    await screen.findByText('claude')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar histórico' }))
    await userEvent.click(screen.getByRole('button', { name: 'Não' }))
    expect(screen.getByRole('button', { name: 'Limpar histórico' })).toBeInTheDocument()
  })

  it('Escape e o X chamam onClose; clique dentro do card não fecha', async () => {
    const onClose = vi.fn()
    installMockApi({ 'commandLog:list': () => ({ entries: [] }) })
    renderWithProviders(<CommandLogModal onClose={onClose} />, { withIssueDetail: false })
    await screen.findByText('Nenhum comando registrado.')

    await userEvent.click(screen.getByText('Nenhum comando registrado.'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByLabelText('Fechar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape fecha o modal mesmo com foco fora dele', async () => {
    const onClose = vi.fn()
    installMockApi({ 'commandLog:list': () => ({ entries: [] }) })
    renderWithProviders(<CommandLogModal onClose={onClose} />, { withIssueDetail: false })
    await screen.findByText('Nenhum comando registrado.')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
