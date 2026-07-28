import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint } from '../../db/repos/catalog'
import { getPrefs } from '../../db/repos/misc'
import { collectPeriodComments } from '../../summaries/selectors'
import { activeProvider, runAiPrompt } from '../../ai/service'
import { AiUnavailableError } from '../../ai/types'
import { buildSprintRisk } from '../../queries/risk'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerRiskHandlers(ctx: AppContext): void {
  handle('sprint:risk', () => {
    const workspace = requireWorkspace(ctx)
    const prefs = getPrefs(ctx.db)
    return buildSprintRisk(
      {
        db: ctx.db,
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        siteUrl: workspace.site_url
      },
      prefs.stalledDays
    )
  })

  handle('sprint:riskExplain', async () => {
    const workspace = requireWorkspace(ctx)
    const provider = activeProvider()
    if (!provider) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'Nenhum provider de IA disponível — configure em Ajustes'
      )
    }
    const prefs = getPrefs(ctx.db)
    const risk = buildSprintRisk(
      {
        db: ctx.db,
        workspaceId: workspace.id,
        accountId: workspace.account_id,
        siteUrl: workspace.site_url
      },
      prefs.stalledDays
    )

    const sprint = getActiveSprint(ctx.db, workspace.id)
    const comentarios = sprint?.startDate
      ? collectPeriodComments(ctx.db, workspace, {
          start: sprint.startDate,
          end: sprint.endDate ?? new Date().toISOString()
        })
      : []

    const prompt = [
      'Você é um analista de sprint. Com base nos cards em risco (JSON) e nos comentários recentes (JSON), escreva um parágrafo objetivo por card em risco alto (score>=2) e uma linha de recomendação geral.',
      'Cite as keys dos cards. Não invente fatos. Responda em português do Brasil, com markdown leve.',
      '',
      '=== CARDS EM RISCO (JSON) ===',
      JSON.stringify(
        risk.items.map((i) => ({
          key: i.issue.key,
          summary: i.issue.summary,
          status: i.issue.status,
          assignee: i.issue.assigneeName,
          score: i.score,
          signals: i.signals
        }))
      ),
      '',
      '=== COMENTÁRIOS RECENTES (JSON) ===',
      JSON.stringify(comentarios)
    ].join('\n')

    try {
      const markdown = await runAiPrompt('ask', prompt)
      return { markdown, generatedBy: provider.id }
    } catch (err) {
      const message =
        err instanceof AiUnavailableError || err instanceof Error
          ? err.message
          : `Não foi possível explicar os riscos (${provider.label})`
      throw new AppError('AI_UNAVAILABLE', message)
    }
  })
}
