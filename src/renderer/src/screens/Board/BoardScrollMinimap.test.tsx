// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { t } from '../../strings/ptBR'
import BoardScrollMinimap from './BoardScrollMinimap'

/**
 * jsdom não faz layout: as métricas de rolagem são plantadas no nó assim que o
 * ref é anexado (antes dos layout effects do minimapa, que é quem mede).
 */
function fakeGeometry(el: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  let scrollLeft = 0
  Object.defineProperty(el, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = v
    }
  })
  const children = Array.from(el.children) as HTMLElement[]
  const colWidth = scrollWidth / children.length
  children.forEach((child, i) => {
    Object.defineProperty(child, 'offsetLeft', { value: i * colWidth, configurable: true })
    Object.defineProperty(child, 'offsetWidth', { value: colWidth, configurable: true })
  })
}

function Harness({
  scrollWidth = 900,
  clientWidth = 300,
  columns = 3
}: {
  scrollWidth?: number
  clientWidth?: number
  columns?: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div
        data-testid="columns"
        ref={(el) => {
          ref.current = el
          if (el) fakeGeometry(el, scrollWidth, clientWidth)
        }}
      >
        {Array.from({ length: columns }, (_, i) => (
          <div key={i}>Coluna {i + 1}</div>
        ))}
      </div>
      <BoardScrollMinimap scrollRef={ref} revision={`c${columns}`} />
    </div>
  )
}

const view = (): HTMLElement => screen.getByTestId('board-scroll-minimap-view')
const columns = (): HTMLElement => screen.getByTestId('columns')

afterEach(cleanup)

describe('BoardScrollMinimap', () => {
  it('não aparece quando todas as colunas cabem na tela', () => {
    render(<Harness scrollWidth={300} clientWidth={300} />)
    expect(screen.queryByTestId('board-scroll-minimap')).not.toBeInTheDocument()
  })

  it('mostra uma barrinha por coluna e a moldura proporcional ao que está visível', () => {
    render(<Harness scrollWidth={900} clientWidth={300} columns={3} />)

    const bars = screen.getByTestId('board-scroll-minimap').querySelectorAll('.bg-zinc-700')
    expect(bars).toHaveLength(3)
    // 1/3 do trilho por coluna, menos a folga entre barras
    expect(parseFloat((bars[0] as HTMLElement).style.width)).toBeCloseTo(118 / 3 - 1.25, 3)
    // 1/3 do quadro visível → moldura com ~1/3 do trilho (118px), começando na origem
    expect(view().style.width).toBe(`${118 / 3 + 6}px`)
    expect(view().style.left).toBe('-3px')
  })

  it('barrinhas vizinhas nunca se encostam, mesmo com muitas colunas', () => {
    // o harness posiciona as colunas coladas (pior caso): a folga tem que vir
    // do minimapa, não do gap real do quadro — que some na escala do trilho
    render(<Harness scrollWidth={2468} clientWidth={952} columns={10} />)

    const bars = Array.from(
      screen.getByTestId('board-scroll-minimap').querySelectorAll<HTMLElement>('.bg-zinc-700')
    ).map((b) => ({ left: parseFloat(b.style.left), width: parseFloat(b.style.width) }))

    expect(bars).toHaveLength(10)
    bars.forEach((bar, i) => {
      expect(bar.width).toBeGreaterThanOrEqual(3)
      const next = bars[i + 1]
      if (next) expect(next.left - (bar.left + bar.width)).toBeGreaterThanOrEqual(1.25)
    })
  })

  it('rolar o quadro desloca a moldura e atualiza o progresso anunciado', () => {
    render(<Harness scrollWidth={900} clientWidth={300} />)
    expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuenow', '0')

    columns().scrollLeft = 600
    fireEvent.scroll(columns())

    // fim do quadro: 600/900 do trilho
    expect(parseFloat(view().style.left)).toBeCloseTo((600 / 900) * 118 - 3, 3)
    expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('arrastar a moldura rola o quadro', () => {
    render(<Harness scrollWidth={900} clientWidth={300} />)
    const bar = screen.getByRole('scrollbar')

    fireEvent.pointerDown(bar, { button: 0, clientX: 10, pointerId: 1 })
    fireEvent.pointerMove(bar, { buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(bar, { pointerId: 1 })

    // arrastou pro fim do trilho → scroll no máximo (900 − 300)
    expect(columns().scrollLeft).toBe(600)
    expect(screen.getByRole('scrollbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('clicar no trilho centra a moldura no ponto clicado', () => {
    render(<Harness scrollWidth={900} clientWidth={300} />)

    // metade do trilho (59px) com a moldura (39,3px) centrada no ponteiro
    fireEvent.pointerDown(screen.getByRole('scrollbar'), { button: 0, clientX: 59, pointerId: 1 })

    expect(columns().scrollLeft).toBeCloseTo(300, 0)
  })

  it('setas do teclado rolam o quadro e Home/End vão aos extremos', () => {
    render(<Harness scrollWidth={900} clientWidth={300} />)
    const bar = screen.getByRole('scrollbar')

    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(columns().scrollLeft).toBe(240) // 80% de uma "tela"

    fireEvent.keyDown(bar, { key: 'End' })
    expect(columns().scrollLeft).toBe(600)

    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(columns().scrollLeft).toBe(360)

    fireEvent.keyDown(bar, { key: 'Home' })
    expect(columns().scrollLeft).toBe(0)

    // tecla sem função não mexe no scroll
    fireEvent.keyDown(bar, { key: 'a' })
    expect(columns().scrollLeft).toBe(0)
  })

  it('é anunciado como barra de rolagem horizontal', () => {
    render(<Harness scrollWidth={900} clientWidth={300} />)
    const bar = screen.getByRole('scrollbar', { name: t.board.scrollHint })
    expect(bar).toHaveAttribute('aria-orientation', 'horizontal')
    expect(bar).toHaveAttribute('tabindex', '0')
  })
})
