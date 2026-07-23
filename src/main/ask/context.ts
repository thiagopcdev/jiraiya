import type Database from 'better-sqlite3'
import { resolvePeriod } from '@shared/periods'
import { queryIssues } from '../queries/issues'
import { buildLeadTime } from '../queries/leadTime'
import { buildVelocity } from '../queries/velocity'
import { buildTeamSummary } from '../queries/team'
import { collectPeriodComments } from '../summaries/selectors'
import { listActiveAlerts } from '../db/repos/misc'
import { getActiveSprint } from '../db/repos/catalog'

/** Snapshot compacto (JSON) dos dados locais, montado para o prompt do Jiraiya. */
export interface AskContext {
  snapshotJson: string
}

function trunc(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Monta um snapshot JSON dos dados já sincronizados para servir de contexto ao
 * "Pergunte ao Jiraiya". Só usa as queries existentes; nada de SQL novo. Alvo:
 * JSON compacto (< ~60KB) — summaries truncados e listas limitadas.
 */
export function buildAskContext(
  db: Database.Database,
  workspace: { id: number; account_id: string; site_url: string },
  stalledDays: number
): AskContext {
  const ctx = {
    db,
    workspaceId: workspace.id,
    accountId: workspace.account_id,
    siteUrl: workspace.site_url
  }
  const now = new Date()
  const week = resolvePeriod({ type: '7d' }, now)
  const weekRange = { start: week.start, end: week.end }

  // sprint ativa + contagens
  const sprint = getActiveSprint(db, workspace.id)
  let sprintAtual: {
    nome: string
    fim: string | null
    total: number
    abertas: number
  } | null = null
  const sprintScope = sprint
    ? queryIssues(ctx, { start: week.start, end: week.end, bucket: 'sprintScope', stalledDays })
    : []
  if (sprint) {
    const abertas = sprintScope.filter((i) => i.statusCategory !== 'done').length
    sprintAtual = {
      nome: sprint.name ?? 'Sprint',
      fim: sprint.endDate,
      total: sprintScope.length,
      abertas
    }
  }

  // meus cards abertos
  const meusCards = queryIssues(ctx, {
    start: week.start,
    end: week.end,
    bucket: 'mine',
    stalledDays
  }).map((i) => ({
    key: i.key,
    summary: trunc(i.summary),
    status: i.status,
    storyPoints: i.storyPoints,
    updatedAt: i.updatedAt
  }))

  // escopo da sprint resumido
  const escopoSprint = sprintScope.map((i) => ({
    key: i.key,
    summary: trunc(i.summary),
    status: i.status,
    assignee: i.assigneeName,
    storyPoints: i.storyPoints
  }))

  // time (últimos 7 dias) — compactado a keys + títulos curtos
  const time = buildTeamSummary(db, workspace, weekRange, stalledDays).map((m) => ({
    nome: m.name,
    souEu: m.isMe,
    emAndamento: m.inProgress.map((i) => `${i.key}: ${trunc(i.summary, 50)}`),
    concluidos: m.done.map((i) => `${i.key}: ${trunc(i.summary, 50)}`),
    movimentacoes: m.movedCount,
    comentarios: m.commentedCount
  }))

  // comentários recentes (7d)
  const comentariosRecentes = collectPeriodComments(db, workspace, weekRange, { limit: 40 }).map(
    (c) => ({ key: c.key, autor: c.autor, quando: c.quando, texto: c.texto })
  )

  // alertas ativos
  const alertasAtivos = listActiveAlerts(db, workspace.id).map((a) => ({
    ruleId: a.ruleId,
    issueKey: a.issueKey,
    message: a.message
  }))

  // lead time (90d)
  const leadTime = buildLeadTime(
    { db, workspaceId: workspace.id, accountId: workspace.account_id },
    { days: 90 }
  ).statuses

  // velocity (últimas 4 sprints)
  const velocity = buildVelocity(
    { db, workspaceId: workspace.id, accountId: workspace.account_id },
    { sprintCount: 4 }
  ).sprints.map((s) => ({ nome: s.name, meus: s.myPoints, total: s.teamPoints }))

  const snapshot = {
    sprintAtual,
    meusCards,
    escopoSprint,
    time,
    comentariosRecentes,
    alertasAtivos,
    leadTime,
    velocity
  }

  return { snapshotJson: JSON.stringify(snapshot) }
}
