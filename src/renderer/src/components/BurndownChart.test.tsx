// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { computeBurndown } from '../lib/burndown'
import { BurndownChart } from './BurndownChart'

const sprintStart = '2026-01-01T12:00:00'
const sprintEnd = '2026-01-15T12:00:00'

describe('BurndownChart', () => {
  afterEach(() => cleanup())

  it('escopo zero não renderiza nada', () => {
    const burndown = computeBurndown([], sprintStart, sprintEnd, new Date('2026-01-05T12:00:00'))
    const { container } = render(
      <BurndownChart burndown={burndown} sprintStart={sprintStart} sprintEnd={sprintEnd} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza o svg com aria-label dos pontos restantes e as datas de início/fim', () => {
    const issues = [
      { storyPoints: 5, resolvedAt: null },
      { storyPoints: 3, resolvedAt: '2026-01-03T12:00:00' }
    ]
    const burndown = computeBurndown(
      issues,
      sprintStart,
      sprintEnd,
      new Date('2026-01-05T12:00:00')
    )
    render(<BurndownChart burndown={burndown} sprintStart={sprintStart} sprintEnd={sprintEnd} />)
    // escopo 8, 3 resolvidos até o último ponto -> restam 5
    expect(screen.getByRole('img', { name: /5 de 8 pontos restantes/ })).toBeInTheDocument()
    expect(screen.getByText('01/01')).toBeInTheDocument()
    expect(screen.getByText('15/01')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
