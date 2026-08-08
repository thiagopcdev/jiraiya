import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { buildTeamSummary } from '../../queries/team'
import { buildVelocity } from '../../queries/velocity'
import { activeProvider } from '../../ai/service'
import { summarizeTeam } from '../../ai/prompts'
import { resolveWithSprint } from './issues'

export function registerTeamHandlers(ctx: AppContext): void {
  handle('team:summary', ({ period }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    const range = resolveWithSprint(ctx, workspace.id, period)
    const prefs = getPrefs(ctx.db)
    const members = buildTeamSummary(
      ctx.db,
      workspace,
      range,
      prefs.stalledDays,
      prefs.inProgressStatuses
    )
    return { members, periodLabel: range.label, syncMode: prefs.syncMode }
  })

  handle('team:narrative', async ({ period }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    const range = resolveWithSprint(ctx, workspace.id, period)
    const prefs = getPrefs(ctx.db)
    const members = buildTeamSummary(
      ctx.db,
      workspace,
      range,
      prefs.stalledDays,
      prefs.inProgressStatuses
    )

    // envia só o essencial pra IA (nomes, chaves, contagens) — uma única chamada
    const compact = members.map((m) => ({
      nome: m.name,
      emAndamento: m.inProgress.map((i) => ({ key: i.key, resumo: i.summary, status: i.status })),
      concluiu: m.done.map((i) => ({ key: i.key, resumo: i.summary })),
      parados: m.stalled.map((i) => ({ key: i.key, resumo: i.summary, dias: i.stalledDays })),
      mudancasDeStatus: m.movedCount,
      comentarios: m.commentedCount
    }))

    try {
      const markdown = await summarizeTeam({
        periodLabel: range.label,
        teamJson: JSON.stringify(compact, null, 2)
      })
      return { ok: true, markdown }
    } catch {
      const label = activeProvider()?.label ?? 'IA'
      return { ok: false, markdown: `${label} indisponível — mostrando apenas o radar do time.` }
    }
  })

  handle('team:velocity', ({ sprintCount }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    return buildVelocity(
      { db: ctx.db, workspaceId: workspace.id, accountId: workspace.account_id },
      { sprintCount: sprintCount ?? 8 }
    )
  })
}
