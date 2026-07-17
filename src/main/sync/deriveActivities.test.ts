import { describe, expect, it } from 'vitest'
import { deriveActivities } from './deriveActivities'
import type { JiraChangelogHistory, JiraComment } from '../jira/types'

const me = { accountId: 'acc-me', displayName: 'Thiago' }
const other = { accountId: 'acc-other', displayName: 'Fulano' }

const changelog: JiraChangelogHistory[] = [
  {
    id: '100',
    author: me,
    created: '2026-07-15T13:00:00.000+0000',
    items: [
      { field: 'status', fromString: 'To Do', toString: 'In Progress' },
      { field: 'assignee', fromString: null, toString: 'Thiago' }
    ]
  },
  {
    id: '101',
    author: me,
    created: '2026-07-16T18:00:00.000+0000',
    items: [
      { field: 'status', fromString: 'In Progress', toString: 'Done' },
      { field: 'resolution', fromString: null, toString: 'Done' },
      { field: 'Story Points', fieldId: 'customfield_10016', fromString: null, toString: '3' }
    ]
  },
  {
    id: '102',
    author: other,
    created: '2026-07-16T19:00:00.000+0000',
    items: [{ field: 'Rank', fromString: '', toString: 'Ranked higher' }]
  }
]

const comments: JiraComment[] = [
  {
    id: '9001',
    author: me,
    created: '2026-07-15T14:30:00.000+0000',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Subi o fix pra HMG' }] }]
    }
  }
]

describe('deriveActivities', () => {
  const run = (): ReturnType<typeof deriveActivities> =>
    deriveActivities({
      issue: {
        key: 'BT-42',
        fields: {
          summary: 'Ajustar login',
          created: '2026-07-10T09:00:00.000+0000',
          reporter: other
        }
      },
      changelog,
      comments,
      storyPointsFieldId: 'customfield_10016'
    })

  it('gera created, status_change, assignment, resolved, estimate_change e comment', () => {
    const kinds = run().map((a) => a.kind)
    expect(kinds).toContain('created')
    expect(kinds.filter((k) => k === 'status_change')).toHaveLength(2)
    expect(kinds).toContain('assignment')
    expect(kinds).toContain('resolved')
    expect(kinds).toContain('estimate_change')
    expect(kinds).toContain('comment')
    // Rank é ignorado
    expect(run()).toHaveLength(7)
  })

  it('source_ids são únicos e determinísticos', () => {
    const ids = run().map((a) => a.sourceId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('changelog:100:0')
    expect(ids).toContain('comment:9001')
    expect(ids).toContain('created:BT-42')
  })

  it('normaliza datas para ISO e extrai texto do comentário', () => {
    const comment = run().find((a) => a.kind === 'comment')!
    expect(comment.bodyText).toBe('Subi o fix pra HMG')
    expect(comment.occurredAt).toBe('2026-07-15T14:30:00.000Z')
    expect(comment.actorAccountId).toBe('acc-me')
  })

  it('status_change carrega from/to', () => {
    const first = run().find((a) => a.sourceId === 'changelog:100:0')!
    expect(first.fromValue).toBe('To Do')
    expect(first.toValue).toBe('In Progress')
  })
})
