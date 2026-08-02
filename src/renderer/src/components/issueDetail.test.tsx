// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  clampDetailPanelWidth,
  DETAIL_PANEL_WIDTH_DEFAULT,
  DETAIL_PANEL_WIDTH_KEY,
  DETAIL_PANEL_WIDTH_MAX,
  DETAIL_PANEL_WIDTH_MIN,
  IssueDetailContext,
  loadDetailPanelWidth,
  saveDetailPanelWidth,
  useIssueDetail
} from './issueDetail'

afterEach(cleanup)

/** Contexto da gaveta: default no-op e leitura via useIssueDetail(). */

function Probe(): React.JSX.Element {
  const { openIssue, close, DockedPanel } = useIssueDetail()
  return (
    <div>
      <button onClick={() => openIssue('BT-1')}>abrir</button>
      <button onClick={close}>fechar</button>
      <DockedPanel />
    </div>
  )
}

describe('issueDetail context', () => {
  it('o valor default é no-op (não lança e não faz nada)', () => {
    render(<Probe />)
    expect(() => screen.getByText('abrir').click()).not.toThrow()
    expect(() => screen.getByText('fechar').click()).not.toThrow()
  })

  it('o DockedPanel default não renderiza nada', () => {
    const { container } = render(<Probe />)
    // só os dois botões da sonda — o DockedPanel default devolve null
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  it('useIssueDetail lê o valor fornecido pelo Provider', () => {
    const openIssue = vi.fn()
    const close = vi.fn()
    render(
      <IssueDetailContext.Provider value={{ openIssue, close, DockedPanel: () => null }}>
        <Probe />
      </IssueDetailContext.Provider>
    )
    screen.getByText('abrir').click()
    expect(openIssue).toHaveBeenCalledWith('BT-1')
    screen.getByText('fechar').click()
    expect(close).toHaveBeenCalled()
  })
})

describe('largura do painel docado', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('clampa nos dois extremos e arredonda', () => {
    expect(clampDetailPanelWidth(100)).toBe(DETAIL_PANEL_WIDTH_MIN)
    expect(clampDetailPanelWidth(5000)).toBe(DETAIL_PANEL_WIDTH_MAX)
    expect(clampDetailPanelWidth(420.6)).toBe(421)
    expect(clampDetailPanelWidth(Number.NaN)).toBe(DETAIL_PANEL_WIDTH_DEFAULT)
  })

  it('sem valor salvo devolve o default de 380', () => {
    expect(loadDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT)
    expect(DETAIL_PANEL_WIDTH_DEFAULT).toBe(380)
  })

  it('persiste e relê a largura já clampada', () => {
    saveDetailPanelWidth(1200)
    expect(localStorage.getItem(DETAIL_PANEL_WIDTH_KEY)).toBe(String(DETAIL_PANEL_WIDTH_MAX))
    expect(loadDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_MAX)

    saveDetailPanelWidth(500)
    expect(loadDetailPanelWidth()).toBe(500)
  })

  it('valor corrompido no localStorage cai no default', () => {
    localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, 'largo')
    expect(loadDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT)
    localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, '')
    expect(loadDetailPanelWidth()).toBe(DETAIL_PANEL_WIDTH_DEFAULT)
  })
})
