import type Database from 'better-sqlite3'
import type { TeamMemberSummary } from '@shared/domain'
import { queryIssues, type IssueQueryCtx } from './issues'
import { lastActivityPerIssue } from '../db/repos/activity'

interface DiscoveredMember {
  accountId: string
  name: string
  activityCount: number
}

/**
 * Descobre os membros do time a partir dos dados já sincronizados:
 * quem agiu no período + quem tem trabalho aberto atribuído agora.
 * Não consulta a API — o "time" se monta do que já está no cache.
 */
export function discoverMembers(
  db: Database.Database,
  workspaceId: number,
  range: { start: string; end: string }
): DiscoveredMember[] {
  const byId = new Map<string, DiscoveredMember>()

  const actors = db
    .prepare(
      `SELECT actor_account_id AS id, MAX(actor_name) AS name, COUNT(*) AS cnt
       FROM issue_activity
       WHERE workspace_id = ? AND actor_account_id IS NOT NULL
         AND occurred_at >= ? AND occurred_at < ?
       GROUP BY actor_account_id`
    )
    .all(workspaceId, range.start, range.end) as Array<{
    id: string
    name: string | null
    cnt: number
  }>
  for (const a of actors) {
    byId.set(a.id, { accountId: a.id, name: a.name ?? 'Sem nome', activityCount: a.cnt })
  }

  const assignees = db
    .prepare(
      `SELECT DISTINCT assignee_account_id AS id, assignee_name AS name
       FROM issue
       WHERE workspace_id = ? AND assignee_account_id IS NOT NULL
         AND (status_category IS NULL OR status_category != 'done')`
    )
    .all(workspaceId) as Array<{ id: string; name: string | null }>
  for (const a of assignees) {
    const existing = byId.get(a.id)
    if (existing) {
      if (existing.name === 'Sem nome' && a.name) existing.name = a.name
    } else {
      byId.set(a.id, { accountId: a.id, name: a.name ?? 'Sem nome', activityCount: 0 })
    }
  }

  return [...byId.values()]
}

export function buildTeamSummary(
  db: Database.Database,
  workspace: { id: number; account_id: string; site_url: string },
  range: { start: string; end: string },
  stalledDays: number,
  inProgressStatuses?: string[]
): TeamMemberSummary[] {
  const members = discoverMembers(db, workspace.id, range)
  const lastActivity = lastActivityPerIssue(db, workspace.id)
  const now = Date.now()

  const summaries = members.map((member): TeamMemberSummary => {
    const ctx: IssueQueryCtx = {
      db,
      workspaceId: workspace.id,
      accountId: member.accountId,
      siteUrl: workspace.site_url
    }
    const common = { start: range.start, end: range.end, stalledDays, inProgressStatuses }

    const inProgress = queryIssues(ctx, { ...common, bucket: 'inProgress' })
    const done = queryIssues(ctx, { ...common, bucket: 'done' })
    const stalled = queryIssues(ctx, { ...common, bucket: 'stalled' }).map((issue) => {
      const last = lastActivity.get(issue.key) ?? issue.updatedAt
      const days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : stalledDays
      return { ...issue, stalledDays: days }
    })
    const movedCount = queryIssues(ctx, { ...common, bucket: 'moved' }).length
    const commentedCount = queryIssues(ctx, { ...common, bucket: 'commented' }).length

    return {
      accountId: member.accountId,
      name: member.name,
      isMe: member.accountId === workspace.account_id,
      inProgress,
      done,
      stalled,
      movedCount,
      commentedCount
    }
  })

  // mais ativos primeiro (entregas + movimentações + comentários); "eu" no fim,
  // já que o foco da tela é o resto do time
  return summaries.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? 1 : -1
    const score = (m: TeamMemberSummary): number =>
      m.done.length * 2 + m.movedCount + m.commentedCount + m.inProgress.length
    const diff = score(b) - score(a)
    return diff !== 0 ? diff : a.name.localeCompare(b.name)
  })
}
