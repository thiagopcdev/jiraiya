import type Database from 'better-sqlite3'
import type { Issue } from '@shared/domain'
import { rowToIssue, type IssueRow } from '../db/repos/issue'

export type IssueBucket =
  'moved' | 'commented' | 'done' | 'inProgress' | 'stalled' | 'rejected' | 'sprintScope' | 'all'

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
  opts: { start: string; end: string; bucket: IssueBucket; stalledDays: number }
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
