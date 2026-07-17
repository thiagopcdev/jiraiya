import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import {
  listBoards,
  listProjects,
  setSelectedProjects,
  upsertBoards,
  upsertProjects
} from '../../db/repos/catalog'

function requireWorkspace(ctx: AppContext): { id: number } {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerProjectHandlers(ctx: AppContext): void {
  handle('projects:list', async ({ refresh }) => {
    const workspace = requireWorkspace(ctx)
    const cached = listProjects(ctx.db, workspace.id)
    if (!refresh && cached.length > 0) return { projects: cached }

    const client = ctx.getClient()
    if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    const remote = await client.listProjects()
    upsertProjects(
      ctx.db,
      workspace.id,
      remote.map((p) => ({
        jiraId: p.id,
        key: p.key,
        name: p.name,
        avatarUrl: p.avatarUrls?.['24x24'] ?? null
      }))
    )
    return { projects: listProjects(ctx.db, workspace.id) }
  })

  handle('projects:setSelected', async ({ keys }) => {
    const workspace = requireWorkspace(ctx)
    setSelectedProjects(ctx.db, workspace.id, keys)

    // descobre boards dos projetos selecionados (para sprints)
    const client = ctx.getClient()
    if (client) {
      for (const key of keys) {
        try {
          const boards = await client.listBoards(key)
          upsertBoards(
            ctx.db,
            workspace.id,
            boards.map((b) => ({
              jiraId: b.id,
              name: b.name ?? null,
              type: b.type ?? null,
              projectKey: b.location?.projectKey ?? key
            }))
          )
        } catch {
          // projeto sem board (ex.: service desk) — segue
        }
      }
    }
    return { ok: true as const }
  })

  handle('boards:list', () => {
    const workspace = requireWorkspace(ctx)
    return { boards: listBoards(ctx.db, workspace.id) }
  })
}
