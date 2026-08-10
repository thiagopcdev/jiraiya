// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, OpenIssueButton } from './IssueDetailProvider.testUtils'
import { DETAIL_PANEL_WIDTH_KEY, useIssueDetail } from './issueDetail'

/**
 * Painel docado (`DockedPanel`): monta o card in-flow, suprime o overlay
 * enquanto estiver montado, redimensiona com clamp/persistência e devolve o
 * overlay abaixo de 1100px de janela (handoff regra 2).
 */

afterEach(cleanup)

/** matchMedia controlável: `wide` decide se `(min-width: 1100px)` casa. */
let wide = true
const realMatchMedia = window.matchMedia

beforeEach(() => {
  localStorage.clear()
  wide = true
  window.matchMedia = ((query: string) => ({
    matches: query.includes('1100') ? wide : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  window.matchMedia = realMatchMedia
})

/**
 * Faz o papel do Quadro: monta o host docado ao lado do resto da tela. O
 * "alternar host" simula troca de rota sem derrubar o provider (um `rerender`
 * do RTL substituiria a árvore inteira, providers inclusive).
 */
function BoardLike({ initialMounted = true }: { initialMounted?: boolean }): React.JSX.Element {
  const { DockedPanel } = useIssueDetail()
  const [mounted, setMounted] = useState(initialMounted)
  return (
    <div>
      <OpenIssueButton issueKey="BT-1" />
      <button type="button" onClick={() => setMounted((v) => !v)}>
        alternar host
      </button>
      {mounted && <DockedPanel />}
    </div>
  )
}

function overlayEl(): Element | null {
  return document.querySelector('.fixed.inset-0.z-50')
}

function panelEl(): HTMLElement {
  const handle = screen.getByRole('separator', { name: 'Redimensionar painel' })
  return handle.parentElement as HTMLElement
}

async function openCard(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
  await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
}

/** MouseEvent no lugar de PointerEvent: jsdom não constrói PointerEvent com clientX. */
function pointer(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX })
}

describe('IssueDetailProvider — painel docado', () => {
  it('monta o card in-flow, com largura default de 380px e sem chrome de overlay', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    const panel = panelEl()
    expect(panel.className).not.toContain('fixed')
    expect(panel.className).toContain('flex-shrink-0')
    // in-flow: sem sombra e sem a transição de entrada da gaveta
    expect(panel.className).not.toContain('shadow-2xl')
    expect(panel.className).not.toContain('transition-transform')
    expect(panel.style.width).toBe('380px')
  })

  it('com o docado montado o provider não renderiza o overlay', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    expect(overlayEl()).toBeNull()
    expect(document.querySelector('.bg-black\\/50')).toBeNull()
  })

  it('sem host docado o card volta a abrir na gaveta sobreposta', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike initialMounted={false} />)
    await openCard()

    expect(overlayEl()).not.toBeNull()
    expect(
      screen.queryByRole('separator', { name: 'Redimensionar painel' })
    ).not.toBeInTheDocument()
  })

  it('desmontar o host docado (troca de rota) devolve o overlay', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()
    expect(overlayEl()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'alternar host' }))
    await waitFor(() => expect(overlayEl()).not.toBeNull())
    expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument()

    // e remontar o host tira o overlay de novo
    await userEvent.click(screen.getByRole('button', { name: 'alternar host' }))
    await waitFor(() => expect(overlayEl()).toBeNull())
  })

  it('fecha o card pelo X do painel docado', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText('Corrigir bug no login')).not.toBeInTheDocument())
    // fechar o card não desmonta o host: nada de overlay aparecendo no lugar
    expect(overlayEl()).toBeNull()
  })

  it('em 380px o cabeçalho mantém o botão de branch e encolhe o select de status', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:transitions': () => ({
        transitions: [
          {
            id: '11',
            name: 'Iniciar',
            toStatusName: 'Em andamento',
            toCategoryKey: 'indeterminate' as const
          }
        ]
      })
    })
    renderWithProviders(<BoardLike />)
    await openCard()

    // copiar o nome do branch não tem outro caminho na UI: fica nos dois modos.
    // Quem cede largura no docado é o <select> de status, verificado abaixo.
    expect(screen.getByRole('button', { name: 'Copiar nome do branch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir no Jira' })).toBeInTheDocument()

    const select = await screen.findByRole('combobox')
    expect(select.className).toContain('text-[11px]')
    expect(select.className).toContain('px-[7px]')
    expect(select.className).toContain('flex-1')
  })

  it('na gaveta sobreposta o botão de branch continua no cabeçalho', async () => {
    wide = false
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    expect(screen.getByRole('button', { name: 'Copiar nome do branch' })).toBeInTheDocument()
  })

  it('mostra os metadados como grade de rótulo + valor', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    // na gaveta o relator sai como "Relator: Ana"; na grade o rótulo é próprio
    const label = screen.getByText('Prioridade')
    expect(label.tagName).toBe('DT')
    expect(label.parentElement?.parentElement?.className).toContain('grid-cols-2')
    expect(screen.getByText('Média')).toBeInTheDocument()
  })
})

describe('IssueDetailProvider — divisor do painel docado', () => {
  it('arrastar para a esquerda alarga e persiste a largura', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    const handle = screen.getByRole('separator', { name: 'Redimensionar painel' })
    fireEvent(handle, pointer('pointerdown', 900))
    fireEvent(window, pointer('pointermove', 800))
    await waitFor(() => expect(panelEl().style.width).toBe('480px'))

    fireEvent(window, pointer('pointerup', 800))
    expect(localStorage.getItem(DETAIL_PANEL_WIDTH_KEY)).toBe('480')
  })

  it('clampa em 700px e em 320px', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    const handle = screen.getByRole('separator', { name: 'Redimensionar painel' })
    fireEvent(handle, pointer('pointerdown', 900))
    fireEvent(window, pointer('pointermove', 0))
    await waitFor(() => expect(panelEl().style.width).toBe('700px'))
    fireEvent(window, pointer('pointerup', 0))
    expect(localStorage.getItem(DETAIL_PANEL_WIDTH_KEY)).toBe('700')

    fireEvent(handle, pointer('pointerdown', 900))
    fireEvent(window, pointer('pointermove', 2000))
    await waitFor(() => expect(panelEl().style.width).toBe('320px'))
    fireEvent(window, pointer('pointerup', 2000))
    expect(localStorage.getItem(DETAIL_PANEL_WIDTH_KEY)).toBe('320')
  })

  it('reabre com a largura persistida', async () => {
    localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, '520')
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    expect(panelEl().style.width).toBe('520px')
  })
})

describe('IssueDetailProvider — fallback abaixo de 1100px', () => {
  it('janela estreita ignora o host docado e abre a gaveta', async () => {
    wide = false
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    expect(
      screen.queryByRole('separator', { name: 'Redimensionar painel' })
    ).not.toBeInTheDocument()
    expect(overlayEl()).not.toBeNull()
  })

  it('encolher a janela abaixo de 1100px troca o docado pela gaveta', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()
    expect(overlayEl()).toBeNull()

    wide = false
    fireEvent(window, new Event('resize'))

    await waitFor(() => expect(overlayEl()).not.toBeNull())
    expect(
      screen.queryByRole('separator', { name: 'Redimensionar painel' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument()
  })

  it('voltar a alargar a janela devolve o painel docado', async () => {
    wide = false
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()
    expect(overlayEl()).not.toBeNull()

    wide = true
    fireEvent(window, new Event('resize'))

    await waitFor(() =>
      expect(screen.getByRole('separator', { name: 'Redimensionar painel' })).toBeInTheDocument()
    )
    expect(overlayEl()).toBeNull()
  })
})
