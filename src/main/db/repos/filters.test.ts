import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { saveFilter, listFilters, deleteFilter } from './filters'

describe('repos/filters', () => {
  let db: Database.Database
  const WS1 = 1
  const WS2 = 2

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://x.atlassian.net', 'e1', 'acc-1', 'now')`
    ).run()
    db.prepare(
      `INSERT INTO workspace (site_url, email, account_id, created_at) VALUES ('https://y.atlassian.net', 'e2', 'acc-2', 'now')`
    ).run()
  })

  it('sem id insere com position = max+1 (0 no primeiro)', () => {
    saveFilter(db, WS1, { name: 'Meus bugs', jql: 'assignee = currentUser()' })
    const rows = listFilters(db, WS1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Meus bugs',
      jql: 'assignee = currentUser()',
      position: 0
    })
  })

  it('inserts subsequentes incrementam position (max+1)', () => {
    saveFilter(db, WS1, { name: 'Filtro A', jql: 'a' })
    saveFilter(db, WS1, { name: 'Filtro B', jql: 'b' })
    saveFilter(db, WS1, { name: 'Filtro C', jql: 'c' })
    const rows = listFilters(db, WS1)
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.name)).toEqual(['Filtro A', 'Filtro B', 'Filtro C'])
  })

  it('com id atualiza name/jql mantendo position', () => {
    saveFilter(db, WS1, { name: 'Filtro A', jql: 'a' })
    saveFilter(db, WS1, { name: 'Filtro B', jql: 'b' })
    const [first] = listFilters(db, WS1)

    saveFilter(db, WS1, { id: first.id, name: 'Filtro A renomeado', jql: 'a2' })

    const rows = listFilters(db, WS1)
    const updated = rows.find((r) => r.id === first.id)
    expect(updated).toMatchObject({ name: 'Filtro A renomeado', jql: 'a2', position: 0 })
    expect(rows).toHaveLength(2)
  })

  it('listFilters ordena por position, id (desempate por id em position empatada)', () => {
    // Insere duas linhas com a mesma position diretamente, simulando um empate
    // que o fluxo normal de saveFilter não produz sozinho.
    db.prepare(
      `INSERT INTO jql_filter (id, workspace_id, name, jql, position, created_at) VALUES (10, ?, 'Z', 'z', 5, 'now')`
    ).run(WS1)
    db.prepare(
      `INSERT INTO jql_filter (id, workspace_id, name, jql, position, created_at) VALUES (5, ?, 'A', 'a', 5, 'now')`
    ).run(WS1)

    const rows = listFilters(db, WS1)
    expect(rows.map((r) => r.id)).toEqual([5, 10])
  })

  it('deleteFilter remove o filtro', () => {
    saveFilter(db, WS1, { name: 'Filtro A', jql: 'a' })
    const [{ id }] = listFilters(db, WS1)

    deleteFilter(db, WS1, id)

    expect(listFilters(db, WS1)).toEqual([])
  })

  it('escopo por workspace: filtro de outro workspace não aparece', () => {
    saveFilter(db, WS1, { name: 'Filtro WS1', jql: 'a' })
    saveFilter(db, WS2, { name: 'Filtro WS2', jql: 'b' })

    expect(listFilters(db, WS1).map((r) => r.name)).toEqual(['Filtro WS1'])
    expect(listFilters(db, WS2).map((r) => r.name)).toEqual(['Filtro WS2'])
  })

  it('escopo por workspace: deleteFilter não remove filtro de outro workspace', () => {
    saveFilter(db, WS2, { name: 'Filtro WS2', jql: 'b' })
    const [{ id }] = listFilters(db, WS2)

    deleteFilter(db, WS1, id)

    expect(listFilters(db, WS2)).toHaveLength(1)
  })
})
