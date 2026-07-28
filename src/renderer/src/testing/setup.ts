/* eslint-disable @typescript-eslint/no-empty-function -- stubs de DOM são vazios por natureza */
/**
 * Setup global do vitest. Roda em TODOS os ambientes (node e jsdom) —
 * tudo que é de DOM fica atrás do guard de `window`.
 */
import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  // jsdom não implementa esses; componentes do app os usam livremente
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as typeof window.matchMedia

  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): never[] {
      return []
    }
  }
  window.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver
  window.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver

  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.scrollTo ??= (() => {}) as typeof Element.prototype.scrollTo
  HTMLElement.prototype.focus ??= () => {}
}
