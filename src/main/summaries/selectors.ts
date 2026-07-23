import type Database from 'better-sqlite3'
import { queryIssues, type IssueQueryCtx } from '../queries/issues'
import { queryTimeline } from '../db/repos/activity'
import { getActiveSprint } from '../db/repos/catalog'

export interface DigestItem {
  key: string
  summary: string
  url: string
  detail?: string
}

export interface PeriodDigest {
  periodLabel: string
  /** issues resolvidas no período */
  concluidos: DigestItem[]
  /** issues que movi (status) e não concluí */
  avancaram: DigestItem[]
  /** issues em que comentei */
  comentados: DigestItem[]
  /** issues que criei no período */
  criados: DigestItem[]
  /** atribuídas a mim, em andamento agora */
  emAndamento: DigestItem[]
  /** flagged/prioridade máxima, abertas */
  bloqueados: DigestItem[]
  /** em andamento sem atividade há N dias */
  paradosHaDias: Array<DigestItem & { dias: number }>
  sprintAtual: { nome: string; fim: string | null; abertas: number } | null
}

export interface CommentDigestItem {
  key: string
  summary: string
  autor: string
  quando: string
  texto: string
}

/**
 * Comentários do período relevantes para o resumo: os que EU escrevi + os que
 * escreveram em cards atribuídos a mim. Só entra no digest quando o resumo vai
 * para o Claude (contexto real de decisões/bloqueios/feedback); o template
 * determinístico não os usa. Limitado e truncado para não inflar o prompt.
 */
export function collectPeriodComments(
  db: Database.Database,
  workspace: { id: number; account_id: string },
  range: { start: string; end: string },
  opts: { limit?: number; maxChars?: number } = {}
): CommentDigestItem[] {
  const limit = opts.limit ?? 30
  const maxChars = opts.maxChars ?? 400
  const rows = db
    .prepare(
      `SELECT a.issue_key AS key, COALESCE(i.summary, a.issue_key) AS summary,
              COALESCE(a.actor_name, 'Alguém') AS autor, a.occurred_at AS quando,
              COALESCE(a.body_text, '') AS texto
       FROM issue_activity a
       LEFT JOIN issue i ON i.workspace_id = a.workspace_id AND i.key = a.issue_key
       WHERE a.workspace_id = ? AND a.kind = 'comment'
         AND a.occurred_at >= ? AND a.occurred_at < ?
         AND (a.actor_account_id = ? OR i.assignee_account_id = ?)
       ORDER BY a.occurred_at DESC
       LIMIT ?`
    )
    .all(
      workspace.id,
      range.start,
      range.end,
      workspace.account_id,
      workspace.account_id,
      limit
    ) as CommentDigestItem[]
  return rows
    .filter((r) => r.texto.trim().length > 0)
    .map((r) => ({
      ...r,
      texto: r.texto.length > maxChars ? `${r.texto.slice(0, maxChars)}…` : r.texto
    }))
}

export function buildPeriodDigest(
  db: Database.Database,
  workspace: { id: number; account_id: string; site_url: string },
  range: { start: string; end: string; label: string },
  stalledDays: number
): PeriodDigest {
  const ctx: IssueQueryCtx = {
    db,
    workspaceId: workspace.id,
    accountId: workspace.account_id,
    siteUrl: workspace.site_url
  }
  const common = { start: range.start, end: range.end, stalledDays }
  const url = (key: string): string => `${workspace.site_url.replace(/\/$/, '')}/browse/${key}`

  const done = queryIssues(ctx, { ...common, bucket: 'done' })
  const doneKeys = new Set(done.map((i) => i.key))
  const moved = queryIssues(ctx, { ...common, bucket: 'moved' }).filter((i) => !doneKeys.has(i.key))
  const commented = queryIssues(ctx, { ...common, bucket: 'commented' })
  const inProgress = queryIssues(ctx, { ...common, bucket: 'inProgress' })
  const stalled = queryIssues(ctx, { ...common, bucket: 'stalled' })

  // últimos status por issue para detalhe de "avancaram"
  const myActivities = queryTimeline(db, workspace.id, {
    start: range.start,
    end: range.end,
    actorAccountId: workspace.account_id,
    limit: 2000
  })
  const lastStatusByIssue = new Map<string, string>()
  const lastActivityByIssue = new Map<string, string>()
  for (const a of myActivities) {
    // timeline vem DESC; o primeiro status visto por issue é o mais recente
    if (a.kind === 'status_change' && !lastStatusByIssue.has(a.issueKey) && a.toValue) {
      lastStatusByIssue.set(a.issueKey, `${a.fromValue ?? '?'} → ${a.toValue}`)
    }
    if (!lastActivityByIssue.has(a.issueKey)) lastActivityByIssue.set(a.issueKey, a.occurredAt)
  }

  const created = myActivities
    .filter((a) => a.kind === 'created' && a.actorAccountId === workspace.account_id)
    .map((a) => ({
      key: a.issueKey,
      summary: a.issueSummary ?? a.issueKey,
      url: url(a.issueKey)
    }))

  const blocked = inProgress
    .concat(stalled)
    .filter(
      (i, idx, arr) =>
        arr.findIndex((x) => x.key === i.key) === idx &&
        (i.flagged || i.priority === 'Highest' || i.priority === 'Blocker')
    )
    .map((i) => ({ key: i.key, summary: i.summary, url: i.url, detail: i.priority ?? undefined }))

  const sprint = getActiveSprint(db, workspace.id)
  let sprintAtual: PeriodDigest['sprintAtual'] = null
  if (sprint) {
    const open = db
      .prepare(
        `SELECT COUNT(*) AS c FROM issue
         WHERE workspace_id = ? AND sprint_jira_id = ? AND (status_category IS NULL OR status_category != 'done')`
      )
      .get(workspace.id, sprint.jiraId) as { c: number }
    sprintAtual = { nome: sprint.name ?? 'Sprint', fim: sprint.endDate, abertas: open.c }
  }

  const nowMs = Date.now()
  return {
    periodLabel: range.label,
    concluidos: done.map((i) => ({ key: i.key, summary: i.summary, url: i.url })),
    avancaram: moved.map((i) => ({
      key: i.key,
      summary: i.summary,
      url: i.url,
      detail: lastStatusByIssue.get(i.key)
    })),
    comentados: commented
      .filter((i) => !doneKeys.has(i.key))
      .map((i) => ({ key: i.key, summary: i.summary, url: i.url })),
    criados: created,
    emAndamento: inProgress.map((i) => ({
      key: i.key,
      summary: i.summary,
      url: i.url,
      detail: i.status ?? undefined
    })),
    bloqueados: blocked,
    paradosHaDias: stalled.map((i) => {
      const last = lastActivityByIssue.get(i.key) ?? i.updatedAt
      const dias = last ? Math.floor((nowMs - new Date(last).getTime()) / 86400000) : stalledDays
      return { key: i.key, summary: i.summary, url: i.url, dias }
    }),
    sprintAtual
  }
}
