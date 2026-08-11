import { useEffect, useState } from 'react'

/**
 * Relógio para contagens exibidas (ex.: "próxima sincronização em 6 min").
 *
 * O render precisa ser puro (react-hooks/purity proíbe Date.now() nele), então
 * o instante vive num estado alimentado pelo efeito. Devolve 0 até o primeiro
 * tique — quem formata deve tratar esse caso.
 *
 * O passo é o do que se quer mostrar, não 1s por reflexo: um contador em
 * minutos re-renderizando de segundo em segundo custa render de tela inteira
 * para nada.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const sync = (): void => setNow(Date.now())
    // primeiro sync agendado: setState síncrono dentro do efeito dispara
    // render em cascata
    const timeout = window.setTimeout(sync, 0)
    const interval = window.setInterval(sync, intervalMs)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [intervalMs])
  return now
}
