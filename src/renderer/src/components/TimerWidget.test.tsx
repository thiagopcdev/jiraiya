// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { installMockApi, MockIpcFailure } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'

afterEach(cleanup)

/**
 * `lib/timer.ts` guarda um cache em memória (`state`) carregado do localStorage
 * só na primeira importação do módulo — por isso cada teste precisa de um
 * import fresco (via `vi.resetModules` + `import()` dinâmico) DEPOIS de semear
 * o localStorage, senão o widget nunca vê os dados semeados aqui.
 */
async function loadFresh(): Promise<{
  TimerWidget: ComponentType
  IssueDetailContext: typeof import('./issueDetail').IssueDetailContext
}> {
  vi.resetModules()
  const [{ default: TimerWidget }, { IssueDetailContext }] = await Promise.all([
    import('./TimerWidget'),
    import('./issueDetail')
  ])
  return { TimerWidget, IssueDetailContext }
}

/** Semeia `jiraiya.timers` no formato de lib/timer.ts. */
function seedTimer(
  issueKey: string,
  entry: { accumulatedMs: number; startedAt: number | null; touchedAt: number }
): void {
  localStorage.setItem('jiraiya.timers', JSON.stringify({ [issueKey]: entry }))
}

beforeEach(() => localStorage.clear())

describe('TimerWidget', () => {
  it('sem timer algum, não renderiza nada', async () => {
    installMockApi()
    const { TimerWidget } = await loadFresh()
    const { container } = renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('timer pausado com tempo acumulado mostra o botão de retomar', async () => {
    seedTimer('BT-1', { accumulatedMs: 65_000, startedAt: null, touchedAt: Date.now() })
    installMockApi()
    const { TimerWidget } = await loadFresh()
    renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    expect(screen.getByText('BT-1')).toBeInTheDocument()
    expect(screen.getByText('1:05')).toBeInTheDocument()
    expect(screen.getByTitle('Retomar')).toBeInTheDocument()
    expect(screen.getByText('Registrar')).toBeInTheDocument()
  })

  it('timer rodando mostra o botão de pausar e some o de registrar', async () => {
    seedTimer('BT-2', { accumulatedMs: 0, startedAt: Date.now() - 3000, touchedAt: Date.now() })
    installMockApi()
    const { TimerWidget } = await loadFresh()
    renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    expect(screen.getByTitle('Pausar')).toBeInTheDocument()
    expect(screen.queryByText('Registrar')).not.toBeInTheDocument()
  })

  it('clicar em Pausar/Retomar alterna o estado (running)', async () => {
    seedTimer('BT-3', { accumulatedMs: 0, startedAt: Date.now() - 1000, touchedAt: Date.now() })
    installMockApi()
    const { TimerWidget } = await loadFresh()
    renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    await userEvent.click(screen.getByTitle('Pausar'))
    await waitFor(() => expect(screen.getByTitle('Retomar')).toBeInTheDocument())
  })

  it('clicar no key do card abre a gaveta', async () => {
    const openIssue = vi.fn()
    seedTimer('BT-4', { accumulatedMs: 5000, startedAt: null, touchedAt: Date.now() })
    installMockApi()
    const { TimerWidget, IssueDetailContext } = await loadFresh()
    renderWithProviders(
      <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
        <TimerWidget />
      </IssueDetailContext.Provider>,
      { withIssueDetail: false }
    )
    await userEvent.click(screen.getByText('BT-4'))
    expect(openIssue).toHaveBeenCalledWith('BT-4')
  })

  it('Registrar chama issues:logWork e reseta o timer', async () => {
    seedTimer('BT-5', { accumulatedMs: 90_000, startedAt: null, touchedAt: Date.now() })
    const api = installMockApi({
      'issues:logWork': () => ({ ok: true, totalTimeSpent: '1h 30m', queued: false })
    })
    const { TimerWidget } = await loadFresh()
    const { container } = renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    await userEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(api.count('issues:logWork')).toBe(1))
    expect(api.lastPayload('issues:logWork')).toMatchObject({
      key: 'BT-5',
      comment: 'Registrado pelo timer do Jiraiya'
    })
    // timer resetado -> widget some (nenhum timer ativo mais)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('falha ao registrar mostra o erro no título do botão', async () => {
    seedTimer('BT-6', { accumulatedMs: 60_000, startedAt: null, touchedAt: Date.now() })
    installMockApi({
      'issues:logWork': () => {
        throw new MockIpcFailure('LOG_FAIL', 'Falha ao registrar.')
      }
    })
    const { TimerWidget } = await loadFresh()
    renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    await userEvent.click(screen.getByText('Registrar'))
    await waitFor(() => expect(screen.getByTitle('Falha ao registrar.')).toBeInTheDocument())
  })

  it('descartar pede confirmação (window.confirm) antes de resetar', async () => {
    seedTimer('BT-7', { accumulatedMs: 60_000, startedAt: null, touchedAt: Date.now() })
    installMockApi()
    const { TimerWidget } = await loadFresh()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = renderWithProviders(<TimerWidget />, { withIssueDetail: false })
    await userEvent.click(screen.getByTitle('Descartar'))
    expect(confirmSpy).toHaveBeenCalled()
    // recusou -> continua mostrando o timer
    expect(screen.getByText('BT-7')).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    await userEvent.click(screen.getByTitle('Descartar'))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    confirmSpy.mockRestore()
  })
})
