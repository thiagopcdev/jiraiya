// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PairTabs } from './PairTabs'

/**
 * Faixa de abas dos pares agrupados da sidebar. A aba ativa sai da rota atual
 * (não de estado local) — é o que mantém nav e tela em acordo quando o usuário
 * chega por link direto ou pelo ⌘K.
 */

afterEach(cleanup)

const tabs = [
  { to: '/filtros', label: 'Filtros' },
  { to: '/timeline', label: 'Timeline' }
]

function renderAt(route: string): void {
  render(
    <MemoryRouter initialEntries={[route]}>
      <PairTabs tabs={tabs} />
    </MemoryRouter>
  )
}

describe('PairTabs', () => {
  it('marca como ativa a aba da rota atual', () => {
    renderAt('/filtros')

    expect(screen.getByRole('link', { name: 'Filtros' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Timeline' })).not.toHaveAttribute('aria-current')
  })

  it('a outra rota do par ativa a aba irmã', () => {
    renderAt('/timeline')

    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Filtros' })).not.toHaveAttribute('aria-current')
  })

  it('rota fora do par não ativa nenhuma aba', () => {
    renderAt('/quadro')

    for (const label of ['Filtros', 'Timeline']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current')
    }
  })

  it('cada aba aponta para a própria rota', () => {
    renderAt('/filtros')

    // MemoryRouter não prefixa com '#'; no app o HashRouter faz isso
    expect(screen.getByRole('link', { name: 'Filtros' })).toHaveAttribute('href', '/filtros')
    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/timeline')
  })
})
