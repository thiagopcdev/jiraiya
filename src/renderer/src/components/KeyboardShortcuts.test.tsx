// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import KeyboardShortcuts from './KeyboardShortcuts'

afterEach(cleanup)

/** Spy do onClick do primeiro card — mutável, reatribuído por teste. */
let onClick1 = (): void => {}

/** Mostra a rota atual (via useLocation) e alguns "cards" navegáveis com j/k,
 * do jeito que qualquer tela real marcaria com [data-kb-row]. */
function Harness(): React.JSX.Element {
  const location = useLocation()
  return (
    <div>
      <p>rota atual: {location.pathname}</p>
      <input placeholder="campo de texto" />
      <button data-kb-row tabIndex={-1} onClick={onClick1}>
        Card 1
      </button>
      <button data-kb-row tabIndex={-1} onClick={() => {}}>
        Card 2
      </button>
      <button data-kb-row tabIndex={-1} onClick={() => {}}>
        Card 3
      </button>
      <KeyboardShortcuts />
    </div>
  )
}

function currentPath(): string {
  return screen.getByText(/rota atual:/).textContent ?? ''
}

describe('KeyboardShortcuts', () => {
  it('sem "?" pressionado, não renderiza nada visível (modal fechado)', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    expect(screen.queryByText('Atalhos de teclado')).not.toBeInTheDocument()
  })

  it('"?" abre o modal de ajuda com os atalhos; "?" de novo fecha', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument()
    expect(screen.getByText('g d')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '?' })
    expect(screen.queryByText('Atalhos de teclado')).not.toBeInTheDocument()
  })

  it('Escape fecha o modal de ajuda', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Atalhos de teclado')).not.toBeInTheDocument()
  })

  it('evento jiraiya:show-shortcuts (disparado pela sidebar) também abre o modal', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    // fireEvent (em vez de window.dispatchEvent puro) garante o flush do
    // setState dentro do act() do React Testing Library
    fireEvent(window, new Event('jiraiya:show-shortcuts'))
    expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument()
  })

  it('clicar fora do modal (overlay) fecha a ajuda', () => {
    installMockApi()
    const { container } = renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: '?' })
    const overlay = container.querySelector('.fixed.inset-0') as HTMLElement
    fireEvent.click(overlay)
    expect(screen.queryByText('Atalhos de teclado')).not.toBeInTheDocument()
  })

  it('g depois q navega para /quadro', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    expect(currentPath()).toContain('/')
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'q' })
    expect(currentPath()).toContain('/quadro')
  })

  it('g depois de expirado o timeout não navega mais', async () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'g' })
    await new Promise((resolve) => setTimeout(resolve, 1300))
    fireEvent.keyDown(window, { key: 'q' })
    expect(currentPath()).not.toContain('/quadro')
  })

  it('com a ajuda aberta, teclas de navegação são ignoradas', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: '?' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'q' })
    expect(currentPath()).not.toContain('/quadro')
    expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument()
  })

  it('digitando em um campo de texto, g+letra não navega (isTypingTarget)', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    const input = screen.getByPlaceholderText('campo de texto')
    fireEvent.keyDown(input, { key: 'g' })
    fireEvent.keyDown(input, { key: 'q' })
    expect(currentPath()).not.toContain('/quadro')
  })

  it('atalho com modificador (metaKey) é ignorado', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'g', metaKey: true })
    fireEvent.keyDown(window, { key: 'q' })
    expect(currentPath()).not.toContain('/quadro')
  })

  it('j/k navegam pelas linhas [data-kb-row] e Enter clica na selecionada', () => {
    const spy = vi.fn()
    onClick1 = spy
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })

    fireEvent.keyDown(window, { key: 'j' })
    expect(document.activeElement).toHaveTextContent('Card 1')

    fireEvent.keyDown(window, { key: 'j' })
    expect(document.activeElement).toHaveTextContent('Card 2')

    fireEvent.keyDown(window, { key: 'k' })
    expect(document.activeElement).toHaveTextContent('Card 1')

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('j não passa do último item nem k do primeiro', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'k' })
    expect(document.activeElement).toHaveTextContent('Card 1')

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(document.activeElement).toHaveTextContent('Card 3')
  })

  it('navegar de rota reseta a posição j/k para o início', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(document.activeElement).toHaveTextContent('Card 2')

    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'q' })
    expect(currentPath()).toContain('/quadro')

    fireEvent.keyDown(window, { key: 'j' })
    expect(document.activeElement).toHaveTextContent('Card 1')
  })

  it('Enter sem uma linha com foco não faz nada (sem crash)', () => {
    installMockApi()
    renderWithProviders(<Harness />, { withIssueDetail: false })
    expect(() => fireEvent.keyDown(window, { key: 'Enter' })).not.toThrow()
  })

  it('sem nenhuma linha [data-kb-row] presente, j/k não quebram', () => {
    installMockApi()
    function Empty(): React.JSX.Element {
      return (
        <div>
          <KeyboardShortcuts />
        </div>
      )
    }
    renderWithProviders(<Empty />, { withIssueDetail: false })
    expect(() => fireEvent.keyDown(window, { key: 'j' })).not.toThrow()
  })

  it('j/k não navegam quando a gaveta está aberta ([data-drawer-open])', () => {
    installMockApi()
    function WithDrawer(): React.JSX.Element {
      return (
        <div>
          <div data-drawer-open />
          <button data-kb-row tabIndex={-1}>
            Card 1
          </button>
          <KeyboardShortcuts />
        </div>
      )
    }
    renderWithProviders(<WithDrawer />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: 'j' })
    // nada deveria ganhar foco por causa do j — o foco permanece no body
    expect(document.activeElement).toBe(document.body)
  })

  it('waitFor não é necessário — modal fecha via onClick do conteúdo sem propagar (stopPropagation)', async () => {
    installMockApi()
    const { container } = renderWithProviders(<Harness />, { withIssueDetail: false })
    fireEvent.keyDown(window, { key: '?' })
    const dialog = container.querySelector('.mx-auto.mt-24') as HTMLElement
    fireEvent.click(dialog)
    await waitFor(() => expect(screen.getByText('Atalhos de teclado')).toBeInTheDocument())
  })
})
