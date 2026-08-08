// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { IpcResponse } from '@shared/ipc-contract'
import { installMockApi } from '../../testing/mockApi'
import { makeQueryClient, renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import Epics from './Epics'

type Epic = IpcResponse<'epics:overview'>['epics'][number]

function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    key: 'BT-100',
    summary: 'Épico de exemplo',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    url: 'https://x.atlassian.net/browse/BT-100',
    total: 10,
    done: 4,
    spTotal: 20,
    spDone: 8,
    ...overrides
  }
}

describe('Epics', () => {
  afterEach(() => cleanup())

  it('mostra o spinner enquanto carrega', () => {
    installMockApi({ 'epics:overview': () => new Promise(() => {}) })
    renderWithProviders(<Epics />, { withIssueDetail: false })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renderiza o título via ScreenHeader', async () => {
    installMockApi({ 'epics:overview': () => ({ epics: [] }) })
    renderWithProviders(<Epics />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Épicos' })).toBeInTheDocument())
  })

  it('contexto do cabeçalho bate com a grade: abertos, concluídos e SP somados', async () => {
    installMockApi({
      'epics:overview': () => ({
        epics: [
          makeEpic({ key: 'BT-100', statusCategory: 'indeterminate', spTotal: 20 }),
          makeEpic({ key: 'BT-101', statusCategory: 'new', spTotal: 5 }),
          makeEpic({ key: 'BT-200', statusCategory: 'done', spTotal: 13 })
        ]
      })
    })
    renderWithProviders(<Epics />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('2 abertos · 1 concluído · 38 sp no total')).toBeInTheDocument()
    )
  })

  it('estado vazio quando não há épicos', async () => {
    installMockApi({ 'epics:overview': () => ({ epics: [] }) })
    renderWithProviders(<Epics />, { withIssueDetail: false })
    await waitFor(() =>
      expect(
        screen.getByText('Nenhum épico encontrado no projeto sincronizado.')
      ).toBeInTheDocument()
    )
  })

  it('renderiza épicos abertos, progresso e SP; concluídos ficam colapsados por padrão', async () => {
    installMockApi({
      'epics:overview': () => ({
        epics: [
          makeEpic({ key: 'BT-100', summary: 'Épico aberto', statusCategory: 'indeterminate' }),
          makeEpic({
            key: 'BT-200',
            summary: 'Épico concluído',
            statusCategory: 'done',
            status: 'Concluído',
            total: 5,
            done: 5,
            spTotal: 10,
            spDone: 10
          })
        ]
      })
    })
    renderWithProviders(<Epics />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByText('Épico aberto')).toBeInTheDocument())
    expect(screen.getByText('4/10 cards')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('8/20 SP')).toBeInTheDocument()

    // o concluído existe só como contador colapsado
    expect(screen.getByText('Concluídos (1)')).toBeInTheDocument()
    expect(screen.queryByText('Épico concluído')).not.toBeInTheDocument()
  })

  it('expande a seção de concluídos ao clicar', async () => {
    installMockApi({
      'epics:overview': () => ({
        epics: [makeEpic({ key: 'BT-200', summary: 'Épico concluído', statusCategory: 'done' })]
      })
    })
    const user = userEvent.setup()
    renderWithProviders(<Epics />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByText('Concluídos (1)')).toBeInTheDocument())
    await user.click(screen.getByText('Concluídos (1)'))
    expect(screen.getByText('Épico concluído')).toBeInTheDocument()
  })

  it('épico sem story points não mostra a linha de SP', async () => {
    installMockApi({
      'epics:overview': () => ({
        epics: [makeEpic({ spTotal: 0, spDone: 0 })]
      })
    })
    renderWithProviders(<Epics />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Épico de exemplo')).toBeInTheDocument())
    expect(screen.queryByText(/SP$/)).not.toBeInTheDocument()
  })

  it('clicar no epic abre a gaveta com a key certa', async () => {
    installMockApi({
      'epics:overview': () => ({ epics: [makeEpic()] })
    })
    const openIssue = vi.fn()
    const user = userEvent.setup()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
          <Epics />
        </IssueDetailContext.Provider>
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText('Épico de exemplo')).toBeInTheDocument())
    await user.click(screen.getByText('Épico de exemplo'))
    expect(openIssue).toHaveBeenCalledWith('BT-100')
  })
})
