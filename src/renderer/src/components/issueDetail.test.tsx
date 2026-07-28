// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IssueDetailContext, useIssueDetail } from './issueDetail'

afterEach(cleanup)

/** Contexto da gaveta: default no-op e leitura via useIssueDetail(). */

function Probe(): React.JSX.Element {
  const { openIssue, close } = useIssueDetail()
  return (
    <div>
      <button onClick={() => openIssue('BT-1')}>abrir</button>
      <button onClick={close}>fechar</button>
    </div>
  )
}

describe('issueDetail context', () => {
  it('o valor default é no-op (não lança e não faz nada)', () => {
    render(<Probe />)
    expect(() => screen.getByText('abrir').click()).not.toThrow()
    expect(() => screen.getByText('fechar').click()).not.toThrow()
  })

  it('useIssueDetail lê o valor fornecido pelo Provider', () => {
    const openIssue = vi.fn()
    const close = vi.fn()
    render(
      <IssueDetailContext.Provider value={{ openIssue, close }}>
        <Probe />
      </IssueDetailContext.Provider>
    )
    screen.getByText('abrir').click()
    expect(openIssue).toHaveBeenCalledWith('BT-1')
    screen.getByText('fechar').click()
    expect(close).toHaveBeenCalled()
  })
})
