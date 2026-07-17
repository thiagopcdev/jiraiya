import { describe, expect, it } from 'vitest'
import { buildSyncJql, formatJqlDate } from './jql'

describe('formatJqlDate', () => {
  it('converte ISO UTC para o timezone do workspace', () => {
    // 2026-07-17T02:30Z em São Paulo (UTC-3) = 2026-07-16 23:30
    expect(formatJqlDate('2026-07-17T02:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-07-16 23:30')
  })
})

describe('buildSyncJql', () => {
  it('modo projeto com cursor aplica janela de overlap de 10min', () => {
    const jql = buildSyncJql({
      mode: 'project',
      projectKeys: ['BT', 'BUGS'],
      cursor: '2026-07-17T12:00:00.000Z',
      backfillDays: 30,
      timeZone: 'America/Sao_Paulo'
    })
    // 12:00Z - 10min = 11:50Z = 08:50 em SP
    expect(jql).toBe('project IN ("BT", "BUGS") AND updated >= "2026-07-17 08:50" ORDER BY updated ASC')
  })

  it('sem cursor usa backfill relativo', () => {
    const jql = buildSyncJql({
      mode: 'project',
      projectKeys: ['BT'],
      cursor: null,
      backfillDays: 30,
      timeZone: null
    })
    expect(jql).toBe('project IN ("BT") AND updated >= -30d ORDER BY updated ASC')
  })

  it('modo pessoal usa currentUser()', () => {
    const jql = buildSyncJql({
      mode: 'personal',
      projectKeys: [],
      cursor: null,
      backfillDays: 14,
      timeZone: null
    })
    expect(jql).toContain('assignee = currentUser()')
    expect(jql).toContain('updated >= -14d')
  })
})
