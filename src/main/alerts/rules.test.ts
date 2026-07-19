import { describe, expect, it } from 'vitest'
import { rules, type AlertSnapshot } from './rules'

const now = new Date('2026-07-17T12:00:00Z')

function issue(
  key: string,
  over: Partial<AlertSnapshot['openIssues'][number]> = {}
): AlertSnapshot['openIssues'][number] {
  return {
    key,
    summary: `Issue ${key}`,
    issueType: 'Task',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: 'acc-me',
    descriptionText: 'Uma descrição adequada para o ticket.',
    storyPoints: 3,
    sprintJiraId: 7,
    flagged: false,
    updatedAt: '2026-07-17T10:00:00.000Z',
    ...over
  }
}

function snap(over: Partial<AlertSnapshot> = {}): AlertSnapshot {
  return {
    openIssues: [],
    lastActivityByIssue: new Map(),
    activeSprint: {
      jiraId: 7,
      boardJiraId: 1,
      name: 'Sprint 42',
      state: 'active',
      startDate: '2026-07-07T00:00:00.000Z',
      endDate: '2026-07-21T00:00:00.000Z'
    },
    stalledDays: 3,
    myAccountId: 'acc-me',
    now,
    ...over
  }
}

const byId = Object.fromEntries(rules.map((r) => [r.id, r]))

describe('alert rules', () => {
  it('blocker: prioridade Highest ou flag', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { priority: 'Highest' }),
        issue('BT-2'),
        issue('BT-3', { flagged: true })
      ]
    })
    const out = byId['blocker'].evaluate(s)
    expect(out.map((c) => c.issueKey).sort()).toEqual(['BT-1', 'BT-3'])
    expect(out[0].severity).toBe('critical')
  })

  it('sem-descricao: vazia ou muito curta', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { descriptionText: null }),
        issue('BT-2', { descriptionText: 'ok' }),
        issue('BT-3')
      ]
    })
    expect(
      byId['sem-descricao']
        .evaluate(s)
        .map((c) => c.issueKey)
        .sort()
    ).toEqual(['BT-1', 'BT-2'])
  })

  it('sem-estimativa: só na sprint ativa e ignora subtask/epic', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { storyPoints: null }),
        issue('BT-2', { storyPoints: null, sprintJiraId: 99 }),
        issue('BT-3', { storyPoints: null, issueType: 'Sub-task' }),
        issue('BT-4')
      ]
    })
    expect(byId['sem-estimativa'].evaluate(s).map((c) => c.issueKey)).toEqual(['BT-1'])
  })

  it('sem-estimativa: sem sprint ativa não dispara', () => {
    const s = snap({ activeSprint: null, openIssues: [issue('BT-1', { storyPoints: null })] })
    expect(byId['sem-estimativa'].evaluate(s)).toHaveLength(0)
  })

  it('in-progress-sem-assignee', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { assigneeAccountId: null }),
        issue('BT-2', { assigneeAccountId: null, statusCategory: 'new' })
      ]
    })
    expect(byId['in-progress-sem-assignee'].evaluate(s).map((c) => c.issueKey)).toEqual(['BT-1'])
  })

  it('parado-x-dias usa última activity, com fallback pro updated', () => {
    const s = snap({
      openIssues: [issue('BT-1'), issue('BT-2', { updatedAt: '2026-07-01T10:00:00.000Z' })],
      lastActivityByIssue: new Map([['BT-1', '2026-07-16T10:00:00.000Z']])
    })
    const out = byId['parado-x-dias'].evaluate(s)
    expect(out.map((c) => c.issueKey)).toEqual(['BT-2'])
    expect(out[0].message).toContain('16 dia(s)')
  })

  it('sprint-acabando: dispara em ≤2 dias com issues abertas', () => {
    const s = snap({
      activeSprint: {
        jiraId: 7,
        boardJiraId: 1,
        name: 'Sprint 42',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-18T12:00:00.000Z'
      },
      openIssues: [issue('BT-1'), issue('BT-2', { sprintJiraId: 99 })]
    })
    const out = byId['sprint-acabando'].evaluate(s)
    expect(out).toHaveLength(1)
    expect(out[0].issueKey).toBeNull()
    expect(out[0].message).toContain('1 issue(s) abertas')
  })

  it('sprint-acabando: não dispara longe do fim', () => {
    expect(byId['sprint-acabando'].evaluate(snap({ openIssues: [issue('BT-1')] }))).toHaveLength(0)
  })
})

describe('reprovado', () => {
  it('dispara para MEUS openIssues com status casando /reprov|rejeit|reject/i', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { status: 'REPROVADO' }),
        issue('BT-2', { status: 'Rejected' }),
        issue('BT-3') // status normal ('In Progress') -> não dispara
      ]
    })
    const out = byId['reprovado'].evaluate(s)
    expect(out.map((c) => c.issueKey).sort()).toEqual(['BT-1', 'BT-2'])
    expect(out[0].severity).toBe('critical')
    expect(out.every((c) => c.message.includes(c.issueKey as string))).toBe(true)
  })

  it('não dispara para card alheio nem para status normal', () => {
    const s = snap({
      openIssues: [
        issue('BT-1', { status: 'Reprovado', assigneeAccountId: 'acc-outro' }),
        issue('BT-2', { status: 'In Progress' })
      ]
    })
    expect(byId['reprovado'].evaluate(s)).toHaveLength(0)
  })
})

describe('sprint-risco', () => {
  it('dispara quando a sprint ativa termina em até 2 dias e há SP em aberto na sprint', () => {
    const s = snap({
      activeSprint: {
        jiraId: 7,
        boardJiraId: 1,
        name: 'Sprint 42',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-19T00:00:00.000Z' // ~1.5 dias de "now"
      },
      openIssues: [
        issue('BT-1', { storyPoints: 3 }),
        issue('BT-2', { sprintJiraId: 99, storyPoints: 5 }) // outra sprint -> não conta
      ]
    })
    const out = byId['sprint-risco'].evaluate(s)
    expect(out).toHaveLength(1)
    expect(out[0].issueKey).toBeNull()
    expect(out[0].message).toContain('Sprint 42')
  })

  it('não dispara se a sprint termina em 5 dias', () => {
    const s = snap({
      activeSprint: {
        jiraId: 7,
        boardJiraId: 1,
        name: 'Sprint 42',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-22T12:00:00.000Z'
      },
      openIssues: [issue('BT-1', { storyPoints: 3 })]
    })
    expect(byId['sprint-risco'].evaluate(s)).toHaveLength(0)
  })

  it('não dispara se o SP em aberto na sprint é 0', () => {
    const s = snap({
      activeSprint: {
        jiraId: 7,
        boardJiraId: 1,
        name: 'Sprint 42',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-19T00:00:00.000Z'
      },
      openIssues: [issue('BT-1', { storyPoints: null })]
    })
    expect(byId['sprint-risco'].evaluate(s)).toHaveLength(0)
  })

  it('não dispara se o endDate já passou', () => {
    const s = snap({
      activeSprint: {
        jiraId: 7,
        boardJiraId: 1,
        name: 'Sprint 42',
        state: 'active',
        startDate: '2026-07-07T00:00:00.000Z',
        endDate: '2026-07-16T00:00:00.000Z'
      },
      openIssues: [issue('BT-1', { storyPoints: 3 })]
    })
    expect(byId['sprint-risco'].evaluate(s)).toHaveLength(0)
  })
})
