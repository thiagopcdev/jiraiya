import type Database from 'better-sqlite3'
import type { Board, Issue } from '@shared/domain'
import { rowToIssue, type IssueRow } from '../db/repos/issue'

/** Lógica pura do Quadro: resolução de colunas, agrupamento e escopo de cards. */

export interface ResolvedColumn {
  name: string
  statusIds: string[]
  statusNames: string[]
}

export interface BoardTransition {
  id: string
  name: string
  toStatusId: string
  toStatusName: string
  toCategoryKey: 'new' | 'indeterminate' | 'done'
}

/**
 * Casa os ids de status de cada coluna com os nomes do catálogo, preservando a
 * ordem da coluna. Id sem correspondência no catálogo é omitido de `statusNames`
 * (mas permanece em `statusIds`, que alimenta o board:move).
 */
export function resolveColumns(
  config: { columns: Array<{ name: string; statusIds: string[] }> },
  statuses: Array<{ id: string; name: string; categoryKey: 'new' | 'indeterminate' | 'done' }>
): ResolvedColumn[] {
  const nameById = new Map(statuses.map((s) => [s.id, s.name]))
  return config.columns.map((c) => ({
    name: c.name,
    statusIds: c.statusIds,
    statusNames: c.statusIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined)
  }))
}

/**
 * Distribui as issues nas colunas casando `issue.status` (NOME) contra
 * `statusNames`, normalizando com trim().toLowerCase(). Cada issue entra em no
 * máximo uma coluna (a primeira que casar); sem correspondência vai para
 * `unmapped`.
 */
export function groupIssuesIntoColumns(
  issues: Issue[],
  columns: ResolvedColumn[]
): { columns: Array<ResolvedColumn & { issues: Issue[] }>; unmapped: Issue[] } {
  const norm = (s: string | null): string => (s ?? '').trim().toLowerCase()
  const withIssues = columns.map((c) => ({ ...c, issues: [] as Issue[] }))
  const normNames = withIssues.map((c) => new Set(c.statusNames.map((n) => norm(n))))
  const unmapped: Issue[] = []
  for (const issue of issues) {
    const key = norm(issue.status)
    let placed = false
    for (let i = 0; i < withIssues.length; i++) {
      if (key !== '' && normNames[i].has(key)) {
        withIssues[i].issues.push(issue)
        placed = true
        break
      }
    }
    if (!placed) unmapped.push(issue)
  }
  return { columns: withIssues, unmapped }
}

/**
 * Escolhe a transição cujo destino casa com um dos status alvo da coluna,
 * iterando `targetStatusIds` NA ORDEM (ordem dos status da coluna). Coluna
 * multi-status → a primeira transição válida vence.
 */
export function pickTransition(
  transitions: BoardTransition[],
  targetStatusIds: string[]
): BoardTransition | null {
  for (const statusId of targetStatusIds) {
    const match = transitions.find((t) => t.toStatusId === statusId)
    if (match) return match
  }
  return null
}

/**
 * Sprint em modo leitura: `shown` existe e é diferente da ativa (ou não há
 * sprint ativa). Sprint ativa selecionada → editável.
 */
export function isReadOnlySprint(
  shown: { jiraId: number } | null,
  active: { jiraId: number } | null
): boolean {
  if (!shown) return false
  return active === null || shown.jiraId !== active.jiraId
}

/**
 * Cards no escopo do board.
 *
 * Scrum: cards da sprint exibida (`sprint_jira_id`). Limitação v1: `sprint_jira_id`
 * guarda só a ÚLTIMA sprint do card — numa sprint fechada, cards que rolaram
 * para uma sprint mais nova não aparecem (aproximação aceita). `sprintJiraId`
 * null → [].
 *
 * Kanban/simple: cards do projeto do board ainda abertos ou "recém-concluídos"
 * (resolvidos nos últimos 14 dias, espelhando o comportamento do Jira).
 * `board.projectKey` null → [].
 */
export function listBoardScopeIssues(
  q: { db: Database.Database; workspaceId: number; siteUrl: string },
  board: Board,
  sprintJiraId: number | null
): Issue[] {
  const { db, workspaceId, siteUrl } = q
  let rows: IssueRow[]
  if (board.type === 'scrum') {
    if (sprintJiraId === null) return []
    rows = db
      .prepare(
        `SELECT * FROM issue
         WHERE workspace_id = ? AND sprint_jira_id = ?
         ORDER BY updated_at DESC`
      )
      .all(workspaceId, sprintJiraId) as IssueRow[]
  } else {
    if (board.projectKey === null) return []
    rows = db
      .prepare(
        `SELECT * FROM issue
         WHERE workspace_id = ? AND project_key = ?
           AND (status_category != 'done' OR status_category IS NULL
                OR resolved_at >= datetime('now','-14 days'))
         ORDER BY updated_at DESC`
      )
      .all(workspaceId, board.projectKey) as IssueRow[]
  }
  return rows.map((r) => rowToIssue(r, siteUrl))
}

/**
 * Colunas de emergência quando a config do board está indisponível: 3 colunas
 * fixas por categoria, com os nomes de status distintos observados nas issues.
 * `statusIds` fica vazio (o fallback não conhece ids) — o renderer desabilita
 * drag & drop via `columnsSource`, então board:move nunca é chamado aqui.
 * `statusCategory` null é tratado como 'new' ('A fazer').
 */
export function fallbackColumns(issues: Issue[]): ResolvedColumn[] {
  const buckets: Record<'new' | 'indeterminate' | 'done', Set<string>> = {
    new: new Set(),
    indeterminate: new Set(),
    done: new Set()
  }
  for (const issue of issues) {
    const cat = issue.statusCategory ?? 'new'
    if (issue.status) buckets[cat].add(issue.status)
  }
  return [
    { name: 'A fazer', statusIds: [], statusNames: [...buckets.new] },
    { name: 'Em andamento', statusIds: [], statusNames: [...buckets.indeterminate] },
    { name: 'Concluído', statusIds: [], statusNames: [...buckets.done] }
  ]
}
