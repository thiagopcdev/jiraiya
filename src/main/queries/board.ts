import type Database from 'better-sqlite3'
import type { Board, Issue } from '@shared/domain'
import { rowToIssue, type IssueRow } from '../db/repos/issue'

/** Lógica pura do Quadro: resolução de colunas, agrupamento e escopo de cards. */

export interface ResolvedColumn {
  name: string
  statusIds: string[]
  statusNames: string[]
  /** limite de WIP da coluna (`columnConfig.columns[].max` no Jira); null = sem constraint configurada (caso comum) */
  wipMax: number | null
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
  config: { columns: Array<{ name: string; statusIds: string[]; wipMax: number | null }> },
  statuses: Array<{ id: string; name: string; categoryKey: 'new' | 'indeterminate' | 'done' }>
): ResolvedColumn[] {
  const nameById = new Map(statuses.map((s) => [s.id, s.name]))
  return config.columns.map((c) => ({
    name: c.name,
    statusIds: c.statusIds,
    statusNames: c.statusIds
      .map((id) => nameById.get(id))
      .filter((n): n is string => n !== undefined),
    wipMax: c.wipMax
  }))
}

/**
 * Coluna de backlog de um quadro kanban: com o recurso Backlog habilitado no
 * Jira, a API de configuração devolve a primeira coluna normalmente, mas o
 * quadro do Jira a esconde (o conteúdo vira a tela "Backlog"). Não existe flag
 * na API — a detecção é pelo nome padrão, só em kanban e só na 1ª posição.
 * Falso negativo (nome customizado) é inofensivo: a coluna fica sem o selo.
 */
export function isBacklogColumn(
  boardType: string | null,
  columnName: string,
  index: number
): boolean {
  if (boardType !== 'kanban' || index !== 0) return false
  const norm = columnName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return norm === 'backlog' || norm === 'lista de pendencias'
}

/**
 * Distribui as issues nas colunas. Cada issue entra em no máximo uma coluna (a
 * primeira que casar); sem correspondência vai para `unmapped`.
 *
 * O casamento é por ID de status (`issue.statusId` contra `statusIds`), não por
 * nome: nome de status se repete num site Jira — cada projeto team-managed cria
 * o seu próprio "Concluído", "Em andamento" etc. Casando por nome, os cards
 * caíam na primeira coluna de nome igual, que pode pertencer a outro fluxo (foi
 * assim que cards concluídos apareceram numa coluna que o quadro do Jira nem
 * mostra).
 *
 * Casa por NOME só quando não há id de um dos lados:
 * - colunas do `fallbackColumns` (não conhecem ids);
 * - card sincronizado antes da migration 011 (`statusId` null), até o sync
 *   voltar a tocá-lo.
 *
 * Com ids nos dois lados, id que não casa com nenhuma coluna vai para
 * `unmapped` — sem recair no nome, que é justamente a fonte do erro.
 */
export function groupIssuesIntoColumns(
  issues: Issue[],
  columns: ResolvedColumn[]
): { columns: Array<ResolvedColumn & { issues: Issue[] }>; unmapped: Issue[] } {
  const norm = (s: string | null): string => (s ?? '').trim().toLowerCase()
  const withIssues = columns.map((c) => ({ ...c, issues: [] as Issue[] }))
  const normNames = withIssues.map((c) => new Set(c.statusNames.map((n) => norm(n))))
  const idSets = withIssues.map((c) => new Set(c.statusIds))
  const columnsHaveIds = withIssues.some((c) => c.statusIds.length > 0)
  const unmapped: Issue[] = []
  for (const issue of issues) {
    const statusId = issue.statusId ?? null
    let target: number
    if (columnsHaveIds && statusId !== null) {
      target = idSets.findIndex((ids) => ids.has(statusId))
    } else {
      const key = norm(issue.status)
      target = key === '' ? -1 : normNames.findIndex((names) => names.has(key))
    }
    if (target >= 0) withIssues[target].issues.push(issue)
    else unmapped.push(issue)
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

/** Janela de "recém-concluído" da coluna de concluídos em quadro kanban. */
const RECENTLY_DONE_DAYS = 14

/**
 * Cards no escopo do board.
 *
 * Scrum: cards da sprint exibida (`sprint_jira_id`). Limitação v1: `sprint_jira_id`
 * guarda só a ÚLTIMA sprint do card — numa sprint fechada, cards que rolaram
 * para uma sprint mais nova não aparecem (aproximação aceita). `sprintJiraId`
 * null → [].
 *
 * Kanban/simple: cards do projeto do board ainda abertos ou "recém-concluídos"
 * (últimos 14 dias, espelhando o comportamento do Jira).
 *
 * A data de conclusão é `resolved_at` (campo `resolutiondate` do Jira) com
 * fallback para `updated_at`: workflow que não preenche a Resolução deixa
 * `resolutiondate` NULL mesmo em card concluído, e sem o fallback a coluna de
 * concluídos ficava SEMPRE vazia no quadro. `updated_at` também cobre o card
 * que acabou de ser arrastado para concluído aqui (board:move só bumpa
 * updated_at), que sem isso desapareceria na hora.
 *
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
    // cutoff em ISO (não datetime('now')) para comparar com o mesmo formato em
    // que as datas são gravadas — 'YYYY-MM-DDTHH:MM:SS.sssZ'
    const cutoff = new Date(Date.now() - RECENTLY_DONE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    rows = db
      .prepare(
        `SELECT * FROM issue
         WHERE workspace_id = ? AND project_key = ?
           AND (status_category != 'done' OR status_category IS NULL
                OR COALESCE(resolved_at, updated_at) >= ?)
         ORDER BY updated_at DESC`
      )
      .all(workspaceId, board.projectKey, cutoff) as IssueRow[]
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
    { name: 'A fazer', statusIds: [], statusNames: [...buckets.new], wipMax: null },
    { name: 'Em andamento', statusIds: [], statusNames: [...buckets.indeterminate], wipMax: null },
    { name: 'Concluído', statusIds: [], statusNames: [...buckets.done], wipMax: null }
  ]
}
