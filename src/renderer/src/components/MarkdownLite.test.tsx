// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarkdownLite } from './MarkdownLite'
import { IssueDetailContext } from './issueDetail'

/**
 * Markdown leve sem lib externa: headings, listas, parágrafos com quebras,
 * negrito e keys de issue (ex.: BT-123) viram botões clicáveis via
 * useIssueDetail().openIssue.
 */

afterEach(cleanup)

function renderWithOpenIssue(text: string, openIssue: (key: string) => void): void {
  render(
    <IssueDetailContext.Provider value={{ openIssue, close: () => {} }}>
      <MarkdownLite text={text} />
    </IssueDetailContext.Provider>
  )
}

describe('MarkdownLite', () => {
  it('renderiza heading (## e ###)', () => {
    render(<MarkdownLite text={'## Título dois\n### Título três'} />)
    expect(screen.getByText('Título dois').tagName).toBe('H4')
    expect(screen.getByText('Título três').tagName).toBe('H4')
  })

  it('renderiza lista com marcadores - e *', () => {
    render(<MarkdownLite text={'- primeiro\n* segundo'} />)
    const list = screen.getByText('primeiro').closest('ul')
    expect(list).toBeInTheDocument()
    expect(screen.getByText('segundo').closest('ul')).toBe(list)
  })

  it('renderiza parágrafo com múltiplas linhas separadas por <br>', () => {
    const { container } = render(<MarkdownLite text={'linha um\nlinha dois'} />)
    const p = screen.getByText('linha um').closest('p')
    expect(p).toBeInTheDocument()
    expect(p?.querySelector('br')).toBeInTheDocument()
    expect(container.textContent).toContain('linha dois')
  })

  it('aplica negrito com **texto**', () => {
    render(<MarkdownLite text={'isto é **importante** de verdade'} />)
    const strong = screen.getByText('importante')
    expect(strong.tagName).toBe('STRONG')
  })

  it('transforma keys de issue em botões clicáveis que chamam openIssue', async () => {
    const openIssue = vi.fn()
    renderWithOpenIssue('ver o card BT-123 para detalhes', openIssue)
    const button = screen.getByRole('button', { name: 'BT-123' })
    await userEvent.click(button)
    expect(openIssue).toHaveBeenCalledWith('BT-123')
  })

  it('reconhece key de issue dentro de negrito e dentro de item de lista', async () => {
    const openIssue = vi.fn()
    renderWithOpenIssue('- bloqueado por **BT-5**', openIssue)
    const button = screen.getByRole('button', { name: 'BT-5' })
    expect(button.closest('strong')).toBeInTheDocument()
    expect(button.closest('li')).toBeInTheDocument()
    await userEvent.click(button)
    expect(openIssue).toHaveBeenCalledWith('BT-5')
  })

  it('texto sem nenhum marcador vira um único parágrafo simples', () => {
    render(<MarkdownLite text="apenas um texto comum" />)
    expect(screen.getByText('apenas um texto comum').closest('p')).toBeInTheDocument()
  })
})
