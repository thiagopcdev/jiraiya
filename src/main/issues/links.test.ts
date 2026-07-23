import { describe, expect, it } from 'vitest'
import { mapIssueLinks } from './links'
import type { JiraIssueLink } from '../jira/types'

describe('mapIssueLinks', () => {
  it('lista vazia -> []', () => {
    expect(mapIssueLinks([])).toEqual([])
  })

  it('outward com type.outward "blocks" -> label "bloqueia", dados do outwardIssue', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        outwardIssue: {
          key: 'BT-2',
          fields: {
            summary: 'Fazer X',
            status: { name: 'A Fazer', statusCategory: { key: 'new' } }
          }
        }
      }
    ]
    expect(mapIssueLinks(raw)).toEqual([
      {
        label: 'bloqueia',
        key: 'BT-2',
        summary: 'Fazer X',
        status: 'A Fazer',
        statusCategory: 'new'
      }
    ])
  })

  it('inward com type.inward -> label "é bloqueado por", dados do inwardIssue', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        inwardIssue: {
          key: 'BT-3',
          fields: {
            summary: 'Fazer Y',
            status: { name: 'Em andamento', statusCategory: { key: 'indeterminate' } }
          }
        }
      }
    ]
    expect(mapIssueLinks(raw)).toEqual([
      {
        label: 'é bloqueado por',
        key: 'BT-3',
        summary: 'Fazer Y',
        status: 'Em andamento',
        statusCategory: 'indeterminate'
      }
    ])
  })

  it('type sem outward/inward -> usa type.name', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Relates' },
        outwardIssue: { key: 'BT-4', fields: { summary: 'Relacionada', status: undefined } }
      }
    ]
    expect(mapIssueLinks(raw)[0].label).toBe('Relates')
  })

  it('sem type -> label "relacionado"', () => {
    const raw: JiraIssueLink[] = [{ outwardIssue: { key: 'BT-5' } }]
    expect(mapIssueLinks(raw)[0].label).toBe('relacionado')
  })

  it('link sem outwardIssue nem inwardIssue -> descartado', () => {
    const raw: JiraIssueLink[] = [{ type: { name: 'Relates' } }]
    expect(mapIssueLinks(raw)).toEqual([])
  })

  it('outwardIssue sem key -> descartado', () => {
    const raw: JiraIssueLink[] = [
      { type: { name: 'Relates' }, outwardIssue: { fields: { summary: 'Sem key' } } }
    ]
    expect(mapIssueLinks(raw)).toEqual([])
  })

  it('summary/status ausentes -> null', () => {
    const raw: JiraIssueLink[] = [{ type: { name: 'Relates' }, outwardIssue: { key: 'BT-6' } }]
    expect(mapIssueLinks(raw)).toEqual([
      { label: 'Relates', key: 'BT-6', summary: null, status: null, statusCategory: null }
    ])
  })

  it('statusCategory fora do union conhecido -> null', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Relates' },
        outwardIssue: {
          key: 'BT-7',
          fields: { summary: 'X', status: { name: 'Custom', statusCategory: { key: 'weird' } } }
        }
      }
    ]
    expect(mapIssueLinks(raw)[0].statusCategory).toBeNull()
  })

  it('um link tem só um dos lados -> uma entrada (não duplica)', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Relates', inward: 'in', outward: 'out' },
        outwardIssue: { key: 'BT-8', fields: { summary: 'Only outward' } }
      }
    ]
    const mapped = mapIssueLinks(raw)
    expect(mapped).toHaveLength(1)
    expect(mapped[0].key).toBe('BT-8')
  })

  it('múltiplos links -> uma entrada por link, na ordem', () => {
    const raw: JiraIssueLink[] = [
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        outwardIssue: { key: 'BT-9' }
      },
      {
        type: { name: 'Blocks', inward: 'é bloqueado por', outward: 'bloqueia' },
        inwardIssue: { key: 'BT-10' }
      }
    ]
    expect(mapIssueLinks(raw).map((l) => l.key)).toEqual(['BT-9', 'BT-10'])
  })
})
