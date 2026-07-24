import { describe, expect, it } from 'vitest'
import { mapSearchResults, summarizeChecks } from './prs'

describe('mapSearchResults', () => {
  it('item válido: mapeia repo, number, title, url, state minúsculo, isDraft, updatedAt', () => {
    const input = [
      {
        number: 12,
        title: 'fix: x',
        url: 'https://github.com/o/r/pull/12',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-07-01T00:00:00Z',
        repository: { nameWithOwner: 'o/r' }
      }
    ]

    expect(mapSearchResults(input)).toEqual([
      {
        repo: 'o/r',
        number: 12,
        title: 'fix: x',
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        isDraft: false,
        updatedAt: '2026-07-01T00:00:00Z'
      }
    ])
  })

  it('item sem number é descartado', () => {
    const input = [
      {
        title: 'fix: x',
        url: 'https://github.com/o/r/pull/1',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-07-01T00:00:00Z',
        repository: { nameWithOwner: 'o/r' }
      }
    ]

    expect(mapSearchResults(input)).toEqual([])
  })

  it('item sem url é descartado', () => {
    const input = [
      {
        number: 1,
        title: 'fix: x',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-07-01T00:00:00Z',
        repository: { nameWithOwner: 'o/r' }
      }
    ]

    expect(mapSearchResults(input)).toEqual([])
  })

  it('item sem repository.nameWithOwner é descartado', () => {
    const input = [
      {
        number: 1,
        title: 'fix: x',
        url: 'https://github.com/o/r/pull/1',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-07-01T00:00:00Z'
      }
    ]

    expect(mapSearchResults(input)).toEqual([])
  })

  it('entrada não-array -> []', () => {
    expect(mapSearchResults(null)).toEqual([])
    expect(mapSearchResults(undefined)).toEqual([])
    expect(mapSearchResults({})).toEqual([])
    expect(mapSearchResults('x')).toEqual([])
  })
})

describe('summarizeChecks', () => {
  it('null -> null', () => {
    expect(summarizeChecks(null)).toBeNull()
  })

  it('[] -> null', () => {
    expect(summarizeChecks([])).toBeNull()
  })

  it('entrada não-array -> null', () => {
    expect(summarizeChecks(undefined)).toBeNull()
    expect(summarizeChecks({})).toBeNull()
    expect(summarizeChecks('x')).toBeNull()
  })

  it('todos SUCCESS -> "passing"', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }])).toBe('passing')
  })

  it('SKIPPED e NEUTRAL contam como "passing"', () => {
    expect(
      summarizeChecks([
        { conclusion: 'SUCCESS' },
        { conclusion: 'SKIPPED' },
        { conclusion: 'NEUTRAL' }
      ])
    ).toBe('passing')
  })

  it('qualquer FAILURE -> "failing", mesmo com outros SUCCESS', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failing')
  })

  it('conclusion ERROR -> "failing"', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'ERROR' }])).toBe('failing')
  })

  it('state ERROR (shape com "state" em vez de "conclusion") -> "failing"', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS' }, { state: 'ERROR' }])).toBe('failing')
  })

  it('status IN_PROGRESS/QUEUED/PENDING sem failures -> "pending"', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending')
    expect(summarizeChecks([{ status: 'QUEUED' }])).toBe('pending')
    expect(summarizeChecks([{ status: 'PENDING' }])).toBe('pending')
  })

  it('failing ganha de pending quando ambos aparecem', () => {
    expect(summarizeChecks([{ status: 'IN_PROGRESS' }, { conclusion: 'FAILURE' }])).toBe('failing')
  })

  it('status COMPLETED com conclusion SUCCESS -> "passing"', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('passing')
  })
})
