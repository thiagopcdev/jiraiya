import type Database from 'better-sqlite3'
import type { Issue } from '@shared/domain'
import { rowToIssue, type IssueRow } from '../db/repos/issue'

export type IssueBucket =
  | 'moved'
  | 'commented'
  | 'done'
  | 'inProgress'
  | 'stalled'
  | 'rejected'
  | 'sprintScope'
  | 'mine'
  | 'all'

/**
 * Normaliza nome de status para comparação: sem acento e sem caixa. O mesmo
 * status aparece como "Aguardando Deploy HMG" num projeto e "AGUARDANDO DEPLOY
 * HMG" em outro.
 */
export function normalizeStatus(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Filtra "trabalho em curso" pelos status escolhidos pelo usuário. Lista vazia
 * mantém o comportamento histórico: toda a categoria 'indeterminate' do Jira —
 * que inclui Code Review, Pronto para Teste e Aguardando Deploy.
 */
function keepInProgress(rows: IssueRow[], statuses: string[] | undefined): IssueRow[] {
  if (!statuses || statuses.length === 0) return rows
  const permitidos = new Set(statuses.map(normalizeStatus))
  return rows.filter((row) => row.status !== null && permitidos.has(normalizeStatus(row.status)))
}

export interface IssueQueryCtx {
  db: Database.Database
  workspaceId: number
  accountId: string
  siteUrl: string
}

/**
 * Buckets do dashboard. Todos relativos ao período [start, end) e ao usuário
 * do workspace (accountId).
 */
export function queryIssues(
  ctx: IssueQueryCtx,
  opts: {
    start: string
    end: string
    bucket: IssueBucket
    stalledDays: number
    /** vazio/ausente = toda a categoria 'indeterminate' (comportamento histórico) */
    inProgressStatuses?: string[]
  }
): Issue[] {
  const { db, workspaceId, accountId, siteUrl } = ctx
  const { start, end, bucket } = opts

  const byActivityKinds = (kinds: string[]): IssueRow[] =>
    db
      .prepare(
        `SELECT DISTINCT i.* FROM issue i
         JOIN issue_activity a ON a.workspace_id = i.workspace_id AND a.issue_key = i.key
         WHERE i.workspace_id = @workspaceId
           AND a.actor_account_id = @accountId
           AND a.kind IN (${kinds.map((k) => `'${k}'`).join(',')})
           AND a.occurred_at >= @start AND a.occurred_at < @end
         ORDER BY i.updated_at DESC`
      )
      .all({ workspaceId, accountId, start, end }) as IssueRow[]

  let rows: IssueRow[]
  switch (bucket) {
    case 'moved':
      rows = byActivityKinds(['status_change'])
      break
    case 'commented':
      rows = byActivityKinds(['comment'])
      break
    case 'done':
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND resolved_at IS NOT NULL AND resolved_at >= @start AND resolved_at < @end
             AND (assignee_account_id = @accountId OR EXISTS (
               SELECT 1 FROM issue_activity a
               WHERE a.workspace_id = workspace_id AND a.issue_key = key
                 AND a.actor_account_id = @accountId AND a.kind = 'resolved'
             ))
           ORDER BY resolved_at DESC`
        )
        .all({ workspaceId, accountId, start, end }) as IssueRow[]
      break
    case 'inProgress':
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND status_category = 'indeterminate'
             AND assignee_account_id = @accountId
           ORDER BY updated_at DESC`
        )
        .all({ workspaceId, accountId }) as IssueRow[]
      rows = keepInProgress(rows, opts.inProgressStatuses)
      break
    case 'stalled': {
      const cutoff = new Date(Date.now() - opts.stalledDays * 24 * 3600 * 1000).toISOString()
      rows = db
        .prepare(
          `SELECT i.* FROM issue i
           WHERE i.workspace_id = @workspaceId
             AND i.status_category = 'indeterminate'
             AND i.assignee_account_id = @accountId
             AND COALESCE((
               SELECT MAX(a.occurred_at) FROM issue_activity a
               WHERE a.workspace_id = i.workspace_id AND a.issue_key = i.key
             ), i.updated_at, '1970-01-01') < @cutoff
           ORDER BY i.updated_at ASC`
        )
        .all({ workspaceId, accountId, cutoff }) as IssueRow[]
      // "parado" é card EM CURSO sem toque há N dias: segue a mesma definição
      // de em curso, senão a mesma tela contaria como parado um card que ela
      // não considera em andamento.
      rows = keepInProgress(rows, opts.inProgressStatuses)
      break
    }
    case 'rejected':
      // estado atual (ignora período): meus cards abertos cujo status indica
      // reprovação. Padrão amplo pt/en em vez de um literal, para tolerar
      // variações de nome de status entre times.
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND assignee_account_id = @accountId
             AND (status_category IS NULL OR status_category != 'done')
             AND (
               LOWER(status) LIKE '%reprov%' OR LOWER(status) LIKE '%rejeit%'
               OR LOWER(status) LIKE '%reject%' OR LOWER(status) LIKE '%devolv%'
             )
           ORDER BY updated_at DESC`
        )
        .all({ workspaceId, accountId }) as IssueRow[]
      break
    case 'mine':
      // estado atual (ignora período): meus cards abertos
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND assignee_account_id = @accountId
             AND (status_category IS NULL OR status_category != 'done')
           ORDER BY updated_at DESC`
        )
        .all({ workspaceId, accountId }) as IssueRow[]
      break
    case 'sprintScope':
      // pertencem à sprint ativa (diferente de "atualizadas no período")
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND sprint_jira_id = (
               SELECT jira_id FROM sprint
               WHERE workspace_id = @workspaceId AND state = 'active'
               ORDER BY start_date DESC LIMIT 1
             )
           ORDER BY updated_at DESC`
        )
        .all({ workspaceId }) as IssueRow[]
      break
    case 'all':
      rows = db
        .prepare(
          `SELECT * FROM issue
           WHERE workspace_id = @workspaceId
             AND updated_at >= @start AND updated_at < @end
           ORDER BY updated_at DESC`
        )
        .all({ workspaceId, start, end }) as IssueRow[]
      break
  }

  return rows.map((r) => rowToIssue(r, siteUrl))
}

/**
 * Busca textual em key/summary/description dos cards do workspace. LIKE é
 * case-insensitive para ASCII; COLLATE NOCASE reforça nas comparações.
 */
export function searchIssues(ctx: IssueQueryCtx, query: string, limit: number): Issue[] {
  const { db, workspaceId, siteUrl } = ctx
  const rows = db
    .prepare(
      `SELECT * FROM issue
       WHERE workspace_id = @workspaceId
         AND (
           key LIKE @q COLLATE NOCASE
           OR summary LIKE @q COLLATE NOCASE
           OR COALESCE(description_text, '') LIKE @q COLLATE NOCASE
         )
       ORDER BY updated_at DESC
       LIMIT @limit`
    )
    .all({ workspaceId, q: '%' + query + '%', limit }) as IssueRow[]
  return rows.map((r) => rowToIssue(r, siteUrl))
}

/**
 * Status da categoria "em progresso" que realmente existem no workspace, com
 * quantos cards do usuário estão em cada um. Alimenta a escolha em
 * Configurações — a lista sai dos dados, não de um enum fixo, porque cada
 * projeto do Jira nomeia o fluxo do seu jeito.
 */
export function listInProgressStatuses(
  ctx: IssueQueryCtx
): Array<{ status: string; total: number; mine: number }> {
  const { db, workspaceId, accountId } = ctx
  return db
    .prepare(
      `SELECT status,
              COUNT(*) AS total,
              SUM(CASE WHEN assignee_account_id = @accountId THEN 1 ELSE 0 END) AS mine
         FROM issue
        WHERE workspace_id = @workspaceId
          AND status_category = 'indeterminate'
          AND status IS NOT NULL
        GROUP BY status
        ORDER BY total DESC, status ASC`
    )
    .all({ workspaceId, accountId }) as Array<{ status: string; total: number; mine: number }>
}
