import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { listBoards } from '../../db/repos/catalog'
import { updateIssueFields } from '../../db/repos/issue'
import { JiraHttpError } from '../../jira/http'
import { parseCreateError } from './create'

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

interface MoveTarget {
  jiraId: number
  name: string | null
  state: 'active' | 'future'
  startDate: string | null
}

export function registerSprintMoveHandlers(ctx: AppContext): void {
  handle('sprint:moveTargets', async () => {
    const workspace = requireWorkspace(ctx)

    // base: sprints ativas/futuras já sincronizadas no DB
    const dbRows = ctx.db
      .prepare(
        `SELECT jira_id, name, state, start_date
         FROM sprint
         WHERE workspace_id = ? AND state IN ('active','future')`
      )
      .all(workspace.id) as Array<{
      jira_id: number
      name: string | null
      state: string
      start_date: string | null
    }>

    const byJiraId = new Map<number, MoveTarget>()
    for (const r of dbRows) {
      byJiraId.set(r.jira_id, {
        jiraId: r.jira_id,
        name: r.name,
        state: r.state === 'active' ? 'active' : 'future',
        startDate: r.start_date
      })
    }

    // refresh ao vivo (melhor esforço): o vivo ganha no dedupe por jiraId.
    // Falha de rede/board sem sprints não é erro — cai só no DB.
    const client = ctx.getClient()
    if (client) {
      for (const board of listBoards(ctx.db, workspace.id)) {
        try {
          const sprints = await client.listSprints(board.jiraId)
          for (const s of sprints) {
            if (s.state !== 'active' && s.state !== 'future') continue
            byJiraId.set(s.id, {
              jiraId: s.id,
              name: s.name ?? null,
              state: s.state,
              startDate: s.startDate ?? null
            })
          }
        } catch {
          // board sem sprints ou rede indisponível — ignora
        }
      }
    }

    // active primeiro; depois future por start_date ASC (null por último)
    const sprints = [...byJiraId.values()]
      .sort((a, b) => {
        const rank = (s: MoveTarget): number => (s.state === 'active' ? 0 : 1)
        if (rank(a) !== rank(b)) return rank(a) - rank(b)
        if (a.startDate === b.startDate) return 0
        if (a.startDate === null) return 1
        if (b.startDate === null) return -1
        return a.startDate < b.startDate ? -1 : 1
      })
      .map((s) => ({ jiraId: s.jiraId, name: s.name, state: s.state }))

    return { sprints }
  })

  handle('sprint:moveIssue', async ({ key, target }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const issueKey = key.trim().toUpperCase()

    try {
      if (target === 'backlog') {
        await client.moveIssuesToBacklog([issueKey])
        updateIssueFields(ctx.db, workspace.id, issueKey, { sprintJiraId: null })
      } else {
        await client.moveIssuesToSprint(target, [issueKey])
        updateIssueFields(ctx.db, workspace.id, issueKey, { sprintJiraId: target })
      }
    } catch (err) {
      if (err instanceof JiraHttpError) {
        throw new AppError(
          'MOVE_FAILED',
          'O Jira recusou a movimentação: ' + parseCreateError(err),
          err
        )
      }
      throw err
    }

    void ctx.scheduler?.trigger({})
    return { ok: true as const }
  })
}
