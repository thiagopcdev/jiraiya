import { describe, expect, it } from 'vitest'
import { filterPeople, type Person } from './people'

const people: Person[] = [
  { accountId: '1', displayName: 'Thiago Prado' },
  { accountId: '2', displayName: 'André Gonçalves' },
  { accountId: '3', displayName: 'Ana Lúcia Souza' },
  { accountId: '4', displayName: 'Marcelo' }
]

describe('filterPeople', () => {
  it('sem termo devolve todo mundo', () => {
    expect(filterPeople(people, '  ')).toHaveLength(4)
  })

  it('casa por prefixo de qualquer palavra do nome', () => {
    expect(filterPeople(people, 'pra').map((p) => p.accountId)).toEqual(['1'])
    expect(filterPeople(people, 'ana').map((p) => p.accountId)).toEqual(['3'])
  })

  it('ignora acento e caixa (o Jira devolve nome como está cadastrado)', () => {
    expect(filterPeople(people, 'ANDRE').map((p) => p.accountId)).toEqual(['2'])
    expect(filterPeople(people, 'lucia').map((p) => p.accountId)).toEqual(['3'])
  })

  it('não casa no meio da palavra — "@rce" não deve trazer Marcelo', () => {
    expect(filterPeople(people, 'rce')).toEqual([])
  })
})
