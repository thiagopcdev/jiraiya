// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { VelocitySprint, VelocitySummary } from '@shared/domain'
import { VelocityChart } from './VelocityChart'

function makeSprint(overrides: Partial<VelocitySprint> = {}): VelocitySprint {
  return {
    sprintJiraId: 1,
    name: 'Sprint 42',
    state: 'closed',
    startDate: '2026-01-01T12:00:00',
    endDate: '2026-01-14T12:00:00',
    myPoints: 3,
    teamPoints: 10,
    myCount: 2,
    teamCount: 5,
    ...overrides
  }
}

describe('VelocityChart', () => {
  afterEach(() => cleanup())

  it('sem sprints não renderiza nada', () => {
    const { container } = render(
      <VelocityChart
        velocity={{ sprints: [], totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 } }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza a legenda, o rótulo de cada sprint e o gráfico SVG', () => {
    const velocity: VelocitySummary = {
      sprints: [
        makeSprint({ sprintJiraId: 1, name: 'Sprint 42', myPoints: 3, teamPoints: 10 }),
        makeSprint({
          sprintJiraId: 2,
          name: 'Sprint 43',
          myPoints: 5,
          teamPoints: 12,
          state: 'active'
        })
      ],
      totals: { myPoints: 8, teamPoints: 22, myCount: 5, teamCount: 11 }
    }
    const { container } = render(<VelocityChart velocity={velocity} />)
    expect(screen.getByText('Você')).toBeInTheDocument()
    expect(screen.getByText('Restante do time')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Entregas por sprint/ })).toBeInTheDocument()

    // rótulo comprime o prefixo comum ("Sprint 4") e marca a ativa com •
    const texts = [...container.querySelectorAll('svg text')].map((n) => n.textContent)
    expect(texts).toContain('3/10')
    expect(texts).toContain('5/12')
    expect(texts).toContain('2')
    expect(texts).toContain('3 •')
  })

  it('usa a data de início quando a sprint não tem nome', () => {
    const velocity: VelocitySummary = {
      sprints: [makeSprint({ name: null, startDate: '2026-03-05T12:00:00' })],
      totals: { myPoints: 3, teamPoints: 10, myCount: 2, teamCount: 5 }
    }
    render(<VelocityChart velocity={velocity} />)
    expect(screen.getByText('05/03')).toBeInTheDocument()
  })
})
