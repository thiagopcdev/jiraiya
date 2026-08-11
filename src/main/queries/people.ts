import type Database from 'better-sqlite3'

export interface Person {
  accountId: string
  displayName: string
}

/**
 * Pessoas que já apareceram nos dados locais (responsável, relator ou autor de
 * atividade), mais recentes primeiro.
 *
 * É a fonte do seletor de menção quando ainda não há o que buscar (o usuário
 * acabou de digitar "@") e o colchão para quando o Jira não responde: o app
 * lê e escreve offline em todo o resto, o seletor não seria exceção.
 */
export function listKnownPeople(db: Database.Database, workspaceId: number, limit = 20): Person[] {
  const rows = db
    .prepare(
      `SELECT account_id AS accountId, name AS displayName, MAX(seen_at) AS seenAt
         FROM (
           SELECT assignee_account_id AS account_id, assignee_name AS name, updated_at AS seen_at
             FROM issue
            WHERE workspace_id = ? AND assignee_account_id IS NOT NULL AND assignee_name IS NOT NULL
           UNION ALL
           SELECT reporter_account_id, reporter_name, updated_at
             FROM issue
            WHERE workspace_id = ? AND reporter_account_id IS NOT NULL AND reporter_name IS NOT NULL
         )
        GROUP BY account_id
        ORDER BY seenAt DESC
        LIMIT ?`
    )
    .all(workspaceId, workspaceId, limit) as Array<{
    accountId: string
    displayName: string
    seenAt: string | null
  }>
  return rows.map((r) => ({ accountId: r.accountId, displayName: r.displayName }))
}

/** Filtro por prefixo de qualquer palavra do nome, sem acento e sem caixa. */
export function filterPeople(people: Person[], query: string): Person[] {
  const norm = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const q = norm(query.trim())
  if (!q) return people
  return people.filter((p) =>
    norm(p.displayName)
      .split(/\s+/)
      .some((part) => part.startsWith(q))
  )
}
