// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, makeIssue, OpenIssueButton } from './IssueDetailProvider.testUtils'

/**
 * Núcleo da gaveta: abrir/fechar, estado "não sincronizado", navegação
 * pai-filho com pilha e o comportamento do Escape (voltar um nível / fechar).
 */

afterEach(cleanup)

describe('IssueDetailProvider — núcleo (abrir/fechar/navegação)', () => {
  it('abre a gaveta com os dados do card e fecha pelo X', async () => {
    const api = installMockApi(baseHandlers(makeIssue()))
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))

    await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('A fazer')).toBeInTheDocument()
    expect(screen.getByText('Tarefa')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText('Corrigir bug no login')).not.toBeInTheDocument())
    expect(api.count('issues:get')).toBe(1)
  })

  it('mostra o estado "não sincronizado" e abre no Jira a partir dele', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:get': () => ({ issue: null }),
      'shell:openIssue': () => ({ ok: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-9" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-9' }))

    await waitFor(() =>
      expect(
        screen.getByText('Este card ainda não foi sincronizado localmente.')
      ).toBeInTheDocument()
    )
    const openButtons = screen.getAllByRole('button', { name: 'Abrir no Jira' })
    await userEvent.click(openButtons[openButtons.length - 1])
    expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-9' })
  })

  it('mostra o spinner enquanto issues:get está carregando', async () => {
    let resolveIssue!: (v: { issue: ReturnType<typeof makeIssue> | null }) => void
    const pending = new Promise<{ issue: ReturnType<typeof makeIssue> | null }>((resolve) => {
      resolveIssue = resolve
    })
    installMockApi({
      ...baseHandlers(),
      'issues:get': () => pending
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()

    resolveIssue({ issue: makeIssue() })
    await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
  })

  it('abrir a mesma key já aberta não empilha nem refaz o fetch', async () => {
    const api = installMockApi(baseHandlers(makeIssue()))
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    // sem novo fetch: o componente não remonta (mesma key no topo da pilha)
    expect(api.count('issues:get')).toBe(1)
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()
  })

  it('navega pai -> filho com pilha, volta e fecha via Escape', async () => {
    const parent = makeIssue({ key: 'BT-1', summary: 'Card pai' })
    const child = makeIssue({ key: 'BT-2', summary: 'Subtarefa filha', parentKey: 'BT-1' })
    const issues: Record<string, ReturnType<typeof makeIssue>> = { 'BT-1': parent, 'BT-2': child }

    installMockApi({
      ...baseHandlers(),
      'issues:get': ({ key }) => ({ issue: issues[key] ?? null }),
      'issues:children': ({ key }) => ({ issues: key === 'BT-1' ? [child] : [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    await waitFor(() => expect(screen.getByText('Card pai')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /BT-2 — Subtarefa filha/ }))
    await waitFor(() => expect(screen.getByText('Subtarefa filha')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(screen.getByText('Card pai')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Card pai')).not.toBeInTheDocument())
  })

  it('Escape com dois níveis volta um nível antes de fechar', async () => {
    const parent = makeIssue({ key: 'BT-1', summary: 'Card pai' })
    const child = makeIssue({ key: 'BT-2', summary: 'Subtarefa filha', parentKey: 'BT-1' })
    const issues: Record<string, ReturnType<typeof makeIssue>> = { 'BT-1': parent, 'BT-2': child }

    installMockApi({
      ...baseHandlers(),
      'issues:get': ({ key }) => ({ issue: issues[key] ?? null }),
      'issues:children': ({ key }) => ({ issues: key === 'BT-1' ? [child] : [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    await waitFor(() => expect(screen.getByText('Card pai')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /BT-2 — Subtarefa filha/ }))
    await waitFor(() => expect(screen.getByText('Subtarefa filha')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByText('Card pai')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Card pai')).not.toBeInTheDocument())
  })

  it('mostra o relator do card', async () => {
    installMockApi(baseHandlers(makeIssue({ reporterAccountId: 'acc-1', reporterName: 'Ana' })))
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))

    await waitFor(() => expect(screen.getByText('Relator: Ana')).toBeInTheDocument())
  })

  it('sem relator local, cai no relator ao vivo da descrição', async () => {
    installMockApi({
      ...baseHandlers(makeIssue({ reporterAccountId: 'acc-1' })),
      'issues:description': () => ({ description: null, markdown: null, reporterName: 'Bruno' })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))

    await waitFor(() => expect(screen.getByText('Relator: Bruno')).toBeInTheDocument())
  })

  it('push:open-issue abre a gaveta automaticamente', async () => {
    const api = installMockApi(
      baseHandlers(makeIssue({ key: 'BT-7', summary: 'Veio da notificação' }))
    )
    renderWithProviders(<div />)

    api.push('push:open-issue', { key: 'BT-7' })
    await waitFor(() => expect(screen.getByText('Veio da notificação')).toBeInTheDocument())
  })
})
