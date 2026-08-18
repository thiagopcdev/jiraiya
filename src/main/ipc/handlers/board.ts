import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import type { SprintListItem } from '@shared/domain'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint, listBoards, listRecentSprints } from '../../db/repos/catalog'
import { getIssueByKey, updateIssueStatus } from '../../db/repos/issue'
import { getPrefs, setPrefs } from '../../db/repos/misc'
import { JiraHttpError } from '../../jira/http'
import { parseCreateError } from './create'
import {
  fallbackColumns,
  groupIssuesIntoColumns,
  isBacklogColumn,
  isReadOnlySprint,
  listBoardScopeIssues,
  pickTransition,
  resolveColumns,
  type ResolvedColumn
} from '../../queries/board'

/** Cache em memória das colunas resolvidas por board (config do Jira é estável). */
const COLUMN_CACHE_TTL_MS = 10 * 60 * 1000
const columnCache = new Map<number, { columns: ResolvedColumn[]; fetchedAt: number }>()

/** Limpa o cache de colunas (ex.: após reconectar/trocar workspace). */
export function clearBoardColumnCache(): void {
  columnCache.clear()
}

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function requireClient(ctx: AppContext): NonNullable<ReturnType<typeof ctx.getClient>> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return client
}

export function registerBoardHandlers(ctx: AppContext): void {
  handle('board:view', async (req) => {
    const ws = requireWorkspace(ctx)
    const db = ctx.db

    const boards = listBoards(db, ws.id)
    if (boards.length === 0) {
      throw new AppError('NO_BOARDS', 'Nenhum board sincronizado — rode uma sincronização')
    }

    // sem board pedido, abre o último usado; sumiu do Jira → scrum → primeiro
    const lastBoardJiraId = getPrefs(db).lastBoardJiraId
    const board = req.boardJiraId
      ? boards.find((b) => b.jiraId === req.boardJiraId)
      : (boards.find((b) => b.jiraId === lastBoardJiraId) ??
        boards.find((b) => b.type === 'scrum') ??
        boards[0])
    if (!board) throw new AppError('BOARD_NOT_FOUND', 'Board não encontrado')
    // lembra a escolha para o próximo acesso (grava só quando muda)
    if (board.jiraId !== lastBoardJiraId) setPrefs(db, { lastBoardJiraId: board.jiraId })

    let sprint: { jiraId: number; name: string } | null = null
    let sprints: SprintListItem[] = []
    let readOnly = false
    let sprintScopeId: number | null = null

    if (board.type === 'scrum') {
      const active = getActiveSprint(db, ws.id)
      sprints = listRecentSprints(db, ws.id, 8).map((s) => ({
        jiraId: s.jiraId,
        name: s.name,
        state: s.state,
        startDate: s.startDate,
        endDate: s.completeDate ?? s.endDate
      }))

      if (req.sprintJiraId !== undefined) {
        const found = sprints.find((s) => s.jiraId === req.sprintJiraId)
        if (!found) throw new AppError('SPRINT_NOT_FOUND', 'Sprint não encontrada')
        sprint = { jiraId: found.jiraId, name: found.name ?? '' }
      } else {
        sprint = active ? { jiraId: active.jiraId, name: active.name ?? '' } : null
      }

      readOnly = isReadOnlySprint(sprint, active ? { jiraId: active.jiraId } : null)
      sprintScopeId = sprint?.jiraId ?? null
    }

    const issues = listBoardScopeIssues(
      { db, workspaceId: ws.id, siteUrl: ws.site_url },
      board,
      sprintScopeId,
      getPrefs(db).boardDoneDays
    )

    // Colunas: cache válido → Jira → fallback (fallback nunca é cacheado).
    let columns: ResolvedColumn[]
    let columnsSource: 'jira' | 'fallback'
    const cached = columnCache.get(board.jiraId)
    if (cached && Date.now() - cached.fetchedAt < COLUMN_CACHE_TTL_MS) {
      columns = cached.columns
      columnsSource = 'jira'
    } else {
      const client = ctx.getClient()
      try {
        if (!client) throw new Error('sem client')
        const config = await client.boardConfiguration(board.jiraId)
        const statuses = await client.listStatuses()
        const resolved = resolveColumns(config, statuses)
        if (resolved.length === 0) throw new Error('colunas vazias')
        columns = resolved
        columnsSource = 'jira'
        columnCache.set(board.jiraId, { columns, fetchedAt: Date.now() })
      } catch {
        columns = fallbackColumns(issues)
        columnsSource = 'fallback'
      }
    }

    const grouped = groupIssuesIntoColumns(issues, columns)
    return {
      board,
      boards,
      sprint,
      sprints,
      readOnly,
      columns: grouped.columns.map((c, i) => ({
        ...c,
        isBacklog: isBacklogColumn(board.type, c.name, i)
      })),
      unmapped: grouped.unmapped,
      columnsSource
    }
  })

  handle('board:move', async ({ issueKey, targetStatusIds, targetColumnName }) => {
    const ws = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const key = issueKey.trim().toUpperCase()

    const row = getIssueByKey(ctx.db, ws.id, key)
    if (!row) throw new AppError('ISSUE_NOT_FOUND', 'Card não encontrado localmente')

    const picked = pickTransition(await client.issueTransitions(key), targetStatusIds)
    if (!picked) {
      throw new AppError(
        'NO_TRANSITION',
        `O Jira não permite mover ${key} para "${targetColumnName}"`
      )
    }

    try {
      await client.doTransition(key, picked.id)
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError(
          'TRANSITION_FAILED',
          'O Jira recusou a transição: ' + parseCreateError(err),
          err
        )
      }
      throw err
    }

    // readOnly não é validado aqui de propósito: a UI desabilita o drag em
    // sprint fechada; o main confia nessa checagem e não duplica a regra.
    updateIssueStatus(
      ctx.db,
      ws.id,
      key,
      picked.toStatusName,
      picked.toCategoryKey,
      picked.toStatusId
    )
    void ctx.scheduler?.trigger({})
    return { newStatus: picked.toStatusName, newStatusCategory: picked.toCategoryKey }
  })
}
