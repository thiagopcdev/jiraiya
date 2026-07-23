import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getActiveSprint } from '../../db/repos/catalog'
import { getPrefs } from '../../db/repos/misc'
import { collectPeriodComments } from '../../summaries/selectors'
import { claudeStatus, runClaudePrompt, ClaudeUnavailableError } from '../../summaries/claude'
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
    if (!claudeStatus().available) {
      throw new AppError(
        'CLAUDE_UNAVAILABLE',
        'CLI do Claude não encontrado — instale o Claude Code para explicar os riscos'
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
      const markdown = await runClaudePrompt(prompt, prefs.modelAsk)
      return { markdown, generatedBy: 'claude' as const }
    } catch (err) {
      const message =
        err instanceof ClaudeUnavailableError || err instanceof Error
          ? err.message
          : 'Não foi possível explicar os riscos com o Claude'
      throw new AppError('CLAUDE_UNAVAILABLE', message)
    }
  })
}
