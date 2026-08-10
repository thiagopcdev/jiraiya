import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../strings/ptBR'

/** Largura útil do trilho (a "régua" que representa o quadro inteiro). */
const TRACK_W = 118
/** Altura das barrinhas de coluna. */
const TRACK_H = 34
/** Folga entre a moldura da viewport e as barrinhas — cabe no p-2 do painel. */
const FRAME_PAD = 3
/**
 * Respiro entre barrinhas vizinhas. O gap real do quadro (12px) encolhe pra
 * menos de 1px na escala do trilho e some no subpixel — as colunas ficavam
 * grudadas. Aqui a folga é descontada da largura de cada barra (a posição
 * segue proporcional ao quadro, então a moldura continua batendo com elas).
 */
const BAR_GAP = 1.25
/** Piso de largura da barrinha, pra ela não sumir em quadros com muitas colunas. */
const BAR_MIN_W = 3

interface Metrics {
  /** posição/largura de cada coluna, já convertidas pra escala do trilho */
  bars: Array<{ left: number; width: number }>
  /** moldura do que está visível agora, na escala do trilho */
  view: { left: number; width: number }
  /** quanto ainda dá pra rolar (px reais) — 0 significa "cabe tudo, não mostra" */
  overflow: number
  scrollLeft: number
  maxScroll: number
}

function measure(el: HTMLElement): Metrics | null {
  const { scrollWidth, clientWidth, scrollLeft } = el
  if (!scrollWidth || !clientWidth) return null
  const overflow = scrollWidth - clientWidth
  const scale = TRACK_W / scrollWidth
  const children = Array.from(el.children) as HTMLElement[]
  const base = children[0]?.offsetLeft ?? 0
  return {
    // toda barra desconta a mesma folga (inclusive a última) — largura e
    // espaçamento uniformes; quem fecha a borda direita é o fundo do trilho,
    // recortado no fim da última barra
    bars: children.map((child) => ({
      left: (child.offsetLeft - base) * scale,
      width: Math.max(child.offsetWidth * scale - BAR_GAP, BAR_MIN_W)
    })),
    view: { left: scrollLeft * scale, width: clientWidth * scale },
    overflow,
    scrollLeft,
    maxScroll: overflow
  }
}

/**
 * Indicador flutuante de rolagem horizontal do quadro (canto inferior direito).
 *
 * Some quando todas as colunas cabem na tela: ele existe justamente pra avisar
 * que há colunas fora do campo de visão. Além de indicar, é um controle — dá
 * pra clicar/arrastar a moldura pra navegar entre as colunas.
 */
export default function BoardScrollMinimap({
  scrollRef,
  /** muda quando o conjunto de colunas muda → força remedição */
  revision
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  revision: string
}): React.JSX.Element | null {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  /** distância entre o ponteiro e a borda esquerda da moldura, durante o arraste */
  const grabRef = useRef<number | null>(null)

  const sync = useCallback(() => {
    const el = scrollRef.current
    setMetrics(el ? measure(el) : null)
  }, [scrollRef])

  useLayoutEffect(sync, [sync, revision])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [scrollRef, sync, revision])

  /** leva o scroll real pra posição do ponteiro sobre o trilho */
  const scrollToPointer = useCallback(
    (clientX: number) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track) return
      const rect = track.getBoundingClientRect()
      // trilho pode estar em 0px (jsdom/layout ainda não resolvido): usa TRACK_W
      const trackW = rect.width || TRACK_W
      const viewW = (el.clientWidth / el.scrollWidth) * trackW
      const grab = grabRef.current ?? viewW / 2
      const left = clientX - rect.left - grab
      const max = trackW - viewW
      const ratio = max > 0 ? Math.min(Math.max(left / max, 0), 1) : 0
      el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth)
      sync()
    },
    [scrollRef, sync]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !metrics) return
    const track = trackRef.current
    const rect = track?.getBoundingClientRect()
    const x = rect ? e.clientX - rect.left : 0
    const inside = x >= metrics.view.left && x <= metrics.view.left + metrics.view.width
    // clique fora da moldura = pular pra lá centralizado; dentro = arrastar
    grabRef.current = inside ? x - metrics.view.left : null
    e.currentTarget.setPointerCapture?.(e.pointerId)
    scrollToPointer(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 1) return
    scrollToPointer(e.clientX)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    grabRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const el = scrollRef.current
    if (!el) return
    const step = el.clientWidth * 0.8
    const targets: Record<string, number> = {
      ArrowLeft: el.scrollLeft - step,
      ArrowRight: el.scrollLeft + step,
      Home: 0,
      End: el.scrollWidth - el.clientWidth
    }
    const next = targets[e.key]
    if (next === undefined) return
    e.preventDefault()
    el.scrollLeft = Math.min(Math.max(next, 0), el.scrollWidth - el.clientWidth)
    sync()
  }

  // cabe tudo na tela → não há rolagem pra anunciar
  if (!metrics || metrics.overflow < 2) return null

  const progress =
    metrics.maxScroll > 0 ? Math.round((metrics.scrollLeft / metrics.maxScroll) * 100) : 0
  const last = metrics.bars[metrics.bars.length - 1]
  const trackFill = last ? last.left + last.width : TRACK_W

  return (
    <div
      className="pointer-events-none absolute right-4 bottom-4 z-10 flex justify-end"
      data-testid="board-scroll-minimap"
    >
      <div
        role="scrollbar"
        aria-label={t.board.scrollHint}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="pointer-events-auto cursor-grab rounded-lg border border-zinc-800 bg-zinc-900/95 p-2 opacity-80 shadow-card transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 active:cursor-grabbing"
      >
        <div ref={trackRef} className="relative" style={{ width: TRACK_W, height: TRACK_H }}>
          {/* fundo um degrau abaixo das barras: a folga entre colunas lê como
              divisória sutil, não como vão escuro. Termina junto com a última
              barra pra não sobrar tira solta na direita */}
          <div
            className="absolute top-0 left-0 rounded-[3px] bg-zinc-800"
            style={{ width: trackFill, height: TRACK_H }}
          />
          {metrics.bars.map((bar, i) => (
            <div
              key={i}
              className="absolute top-0 rounded-[2px] bg-zinc-700"
              style={{ left: bar.left, width: bar.width, height: TRACK_H }}
            />
          ))}
          <div
            data-testid="board-scroll-minimap-view"
            className="absolute rounded-md border-2 border-indigo-400 bg-indigo-400/10"
            style={{
              left: metrics.view.left - FRAME_PAD,
              width: metrics.view.width + FRAME_PAD * 2,
              top: -FRAME_PAD,
              height: TRACK_H + FRAME_PAD * 2
            }}
          />
        </div>
      </div>
    </div>
  )
}
