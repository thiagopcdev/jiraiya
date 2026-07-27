import { describe, expect, it } from 'vitest'
import { mapChangelog, type RawChangelogHistory } from './changelog'

describe('mapChangelog', () => {
  it('ordena as entradas por created DESC', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [{ field: 'status', fromString: 'A Fazer', toString: 'Em andamento' }]
      },
      {
        id: '2',
        created: '2024-03-01T10:00:00.000Z',
        items: [{ field: 'status', fromString: 'Em andamento', toString: 'Concluído' }]
      }
    ]

    const result = mapChangelog(histories)
    expect(result.map((e) => e.id)).toEqual(['2', '1'])
  })

  it('descarta item sem field e sem fieldId', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [
          { fromString: 'a', toString: 'b' },
          { field: 'status', fromString: 'A Fazer', toString: 'Em andamento' }
        ]
      }
    ]

    const result = mapChangelog(histories)
    expect(result).toHaveLength(1)
    expect(result[0].items).toHaveLength(1)
    expect(result[0].items[0].field).toBe('Status')
  })

  it('descarta entrada sem items', () => {
    const histories: RawChangelogHistory[] = [{ id: '1', created: '2024-01-01T10:00:00.000Z' }]

    expect(mapChangelog(histories)).toEqual([])
  })

  it('descarta entrada cujos items ficaram todos vazios (ex.: só Rank ou sem field)', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [
          { field: 'Rank', fromString: 'a', toString: 'b' },
          { fromString: 'x', toString: 'y' }
        ]
      }
    ]

    expect(mapChangelog(histories)).toEqual([])
  })

  it("descarta itens com field 'Rank'", () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [
          { field: 'Rank', fromString: 'a', toString: 'b' },
          { field: 'status', fromString: 'A Fazer', toString: 'Em andamento' }
        ]
      }
    ]

    const result = mapChangelog(histories)
    expect(result[0].items).toEqual([{ field: 'Status', from: 'A Fazer', to: 'Em andamento' }])
  })

  it.each([
    ['status', 'Status'],
    ['assignee', 'Responsável'],
    ['priority', 'Prioridade'],
    ['summary', 'Título'],
    ['Sprint', 'Sprint'],
    ['sprint', 'Sprint'],
    ['Story point estimate', 'Story points'],
    ['timespent', 'Tempo registrado']
  ])('rótulo do campo conhecido %s → %s', (field, label) => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [{ field, fromString: 'a', toString: 'b' }]
      }
    ]

    expect(mapChangelog(histories)[0].items[0].field).toBe(label)
  })

  it('campo desconhecido customfield_x vira Customfield_x (primeira letra maiúscula)', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [{ field: 'customfield_x', fromString: 'a', toString: 'b' }]
      }
    ]

    expect(mapChangelog(histories)[0].items[0].field).toBe('Customfield_x')
  })

  it('from/to vem de fromString/toString, com undefined mapeado para null', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        created: '2024-01-01T10:00:00.000Z',
        items: [{ field: 'status', fromString: undefined, toString: undefined }]
      }
    ]

    expect(mapChangelog(histories)[0].items[0]).toEqual({
      field: 'Status',
      from: null,
      to: null
    })
  })

  it('authorName vem de author.displayName, ou null se author ausente', () => {
    const histories: RawChangelogHistory[] = [
      {
        id: '1',
        author: { displayName: 'Fulano' },
        created: '2024-01-01T10:00:00.000Z',
        items: [{ field: 'status', fromString: 'a', toString: 'b' }]
      },
      {
        id: '2',
        created: '2024-02-01T10:00:00.000Z',
        items: [{ field: 'status', fromString: 'a', toString: 'b' }]
      }
    ]

    const result = mapChangelog(histories)
    expect(result.find((e) => e.id === '1')?.authorName).toBe('Fulano')
    expect(result.find((e) => e.id === '2')?.authorName).toBeNull()
  })
})
