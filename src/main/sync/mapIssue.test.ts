import { describe, expect, it } from 'vitest'
import { mapIssue } from './mapIssue'
import type { JiraIssue } from '../jira/types'

const fieldIds = {
  storyPointsFieldId: 'customfield_10016',
  sprintFieldId: 'customfield_10020',
  flaggedFieldId: 'customfield_10021'
}

function raw(over: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    id: '1001',
    key: 'BT-1',
    fields: {
      summary: 'Ajustar login',
      project: { key: 'BT' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      created: '2026-07-01T09:00:00.000+0000',
      updated: '2026-07-16T10:00:00.000+0000',
      ...over
    }
  }
}

describe('mapIssue — flagged', () => {
  it('flag marcada (array com opção) -> flagged true', () => {
    const mapped = mapIssue(raw({ customfield_10021: [{ value: 'Impediment' }] }), fieldIds)
    expect(mapped.flagged).toBe(true)
  })

  it('campo ausente ou array vazio -> flagged false', () => {
    expect(mapIssue(raw(), fieldIds).flagged).toBe(false)
    expect(mapIssue(raw({ customfield_10021: [] }), fieldIds).flagged).toBe(false)
    expect(mapIssue(raw({ customfield_10021: null }), fieldIds).flagged).toBe(false)
  })

  it('sem field id descoberto -> flagged false sempre', () => {
    const mapped = mapIssue(raw({ customfield_10021: [{ value: 'Impediment' }] }), {
      ...fieldIds,
      flaggedFieldId: null
    })
    expect(mapped.flagged).toBe(false)
  })

  it('id do status vai para statusId (é ele que casa o card com a coluna do quadro)', () => {
    const mapped = mapIssue(
      raw({ status: { id: '10001', name: 'Concluído', statusCategory: { key: 'done' } } }),
      fieldIds
    )
    expect(mapped.statusId).toBe('10001')
    expect(mapped.status).toBe('Concluído')
  })

  it('status sem id na resposta -> statusId null', () => {
    expect(mapIssue(raw(), fieldIds).statusId).toBeNull()
  })

  it('story points e sprint continuam mapeando', () => {
    const mapped = mapIssue(
      raw({ customfield_10016: 5, customfield_10020: [{ id: 77, state: 'active' }] }),
      fieldIds
    )
    expect(mapped.storyPoints).toBe(5)
    expect(mapped.sprintJiraId).toBe(77)
  })
})
