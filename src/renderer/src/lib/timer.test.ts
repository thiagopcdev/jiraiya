// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O módulo mantém estado global em memória (carregado do localStorage no
 * import). Para isolar cada teste, limpamos o localStorage e forçamos um
 * reimport do módulo — assim `state` nasce vazio a cada teste.
 */
async function freshTimerModule(): Promise<typeof import('./timer')> {
  vi.resetModules()
  return import('./timer')
}

describe('lib/timer', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // useNowWhile registra setInterval/setTimeout reais enquanto um timer roda;
  // sem desmontar os hooks, eles vazam pro próximo arquivo de teste (o jsdom
  // já foi derrubado quando o callback dispara -> "window is not defined").
  afterEach(() => cleanup())

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatTimer', () => {
    it('formata mm:ss abaixo de uma hora', async () => {
      const { formatTimer } = await freshTimerModule()
      expect(formatTimer(0)).toBe('0:00')
      expect(formatTimer(65)).toBe('1:05')
    })

    it('formata h:mm:ss a partir de uma hora', async () => {
      const { formatTimer } = await freshTimerModule()
      expect(formatTimer(3661)).toBe('1:01:01')
    })
  })

  describe('formatJiraDuration', () => {
    it('arredonda pra cima em minutos, mínimo 1m', async () => {
      const { formatJiraDuration } = await freshTimerModule()
      expect(formatJiraDuration(0)).toBe('1m')
      expect(formatJiraDuration(30)).toBe('1m')
      expect(formatJiraDuration(90)).toBe('2m')
    })

    it('formata horas e combina com minutos quando há resto', async () => {
      const { formatJiraDuration } = await freshTimerModule()
      expect(formatJiraDuration(3600)).toBe('1h')
      expect(formatJiraDuration(3660)).toBe('1h 1m')
    })
  })

  describe('start/pause/reset/timerSeconds', () => {
    it('startTimer conta o tempo decorrido; pauseTimer congela o acumulado', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const { startTimer, pauseTimer, timerSeconds } = await freshTimerModule()

      startTimer('BT-1')
      vi.setSystemTime(new Date('2026-01-01T10:00:10Z'))
      expect(timerSeconds('BT-1')).toBe(10)

      pauseTimer('BT-1')
      vi.setSystemTime(new Date('2026-01-01T10:01:00Z'))
      expect(timerSeconds('BT-1')).toBe(10)
    })

    it('iniciar um timer em outro card pausa o anterior (só um roda por vez)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const { startTimer, timerSeconds } = await freshTimerModule()

      startTimer('BT-A')
      vi.setSystemTime(new Date('2026-01-01T10:00:05Z'))
      startTimer('BT-B')
      vi.setSystemTime(new Date('2026-01-01T10:00:15Z'))

      expect(timerSeconds('BT-A')).toBe(5)
      expect(timerSeconds('BT-B')).toBe(10)
    })

    it('resetTimer zera o card e pauseTimer em card inexistente não quebra', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const { startTimer, resetTimer, pauseTimer, timerSeconds } = await freshTimerModule()

      startTimer('BT-1')
      vi.setSystemTime(new Date('2026-01-01T10:00:10Z'))
      resetTimer('BT-1')
      expect(timerSeconds('BT-1')).toBe(0)

      expect(() => pauseTimer('BT-inexistente')).not.toThrow()
    })

    it('persiste em localStorage entre reimports do módulo', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const mod1 = await freshTimerModule()
      mod1.startTimer('BT-1')
      mod1.pauseTimer('BT-1')
      vi.setSystemTime(new Date('2026-01-01T10:00:20Z'))

      vi.resetModules()
      const mod2 = await import('./timer')
      expect(mod2.timerSeconds('BT-1')).toBe(0) // pausado, sem ticks — acumulado é o que já havia
    })
  })

  describe('useIssueTimer', () => {
    it('reflete start/pause/reset e hasTime', async () => {
      const { useIssueTimer } = await freshTimerModule()
      const { result } = renderHook(() => useIssueTimer('BT-1'))

      expect(result.current.seconds).toBe(0)
      expect(result.current.running).toBe(false)
      expect(result.current.hasTime).toBe(false)

      act(() => result.current.start())
      expect(result.current.running).toBe(true)
      expect(result.current.hasTime).toBe(true)

      act(() => result.current.pause())
      expect(result.current.running).toBe(false)

      act(() => result.current.reset())
      expect(result.current.hasTime).toBe(false)
    })

    it('sincroniza entre "janelas" via evento storage', async () => {
      const { useIssueTimer } = await freshTimerModule()
      const { result } = renderHook(() => useIssueTimer('BT-2'))
      expect(result.current.seconds).toBe(0)

      act(() => {
        localStorage.setItem(
          'jiraiya.timers',
          JSON.stringify({
            'BT-2': { accumulatedMs: 5000, startedAt: null, touchedAt: Date.now() }
          })
        )
        window.dispatchEvent(new StorageEvent('storage', { key: 'jiraiya.timers' }))
      })

      expect(result.current.seconds).toBe(5)
    })

    it('ignora eventos storage de outra chave', async () => {
      const { useIssueTimer } = await freshTimerModule()
      const { result } = renderHook(() => useIssueTimer('BT-3'))

      act(() => {
        localStorage.setItem('outra.chave', 'x')
        window.dispatchEvent(new StorageEvent('storage', { key: 'outra.chave' }))
      })

      expect(result.current.seconds).toBe(0)
    })
  })

  describe('useActiveTimer', () => {
    it('null quando nenhum timer tem tempo acumulado', async () => {
      const { useActiveTimer } = await freshTimerModule()
      const { result } = renderHook(() => useActiveTimer())
      expect(result.current).toBeNull()
    })

    it('retorna o timer em execução', async () => {
      const { useActiveTimer, startTimer } = await freshTimerModule()
      const { result } = renderHook(() => useActiveTimer())

      act(() => startTimer('BT-9'))

      expect(result.current?.issueKey).toBe('BT-9')
      expect(result.current?.running).toBe(true)
    })

    it('sem timer rodando, prefere o pausado tocado mais recentemente (>= 1s acumulado)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const { useActiveTimer, startTimer, pauseTimer } = await freshTimerModule()

      startTimer('BT-OLD')
      vi.setSystemTime(new Date('2026-01-01T10:00:05Z'))
      pauseTimer('BT-OLD')

      vi.setSystemTime(new Date('2026-01-01T10:00:10Z'))
      startTimer('BT-NEW')
      vi.setSystemTime(new Date('2026-01-01T10:00:15Z'))
      pauseTimer('BT-NEW')

      const { result } = renderHook(() => useActiveTimer())
      expect(result.current?.issueKey).toBe('BT-NEW')
      expect(result.current?.running).toBe(false)
    })
  })
})
