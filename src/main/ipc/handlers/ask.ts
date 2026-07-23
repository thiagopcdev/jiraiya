import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { claudeStatus } from '../../summaries/claude'
import { buildAskContext } from '../../ask/context'
import { askJiraiya } from '../../ask/ask'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

export function registerAskHandlers(ctx: AppContext): void {
  handle('ask:question', async ({ question, history }) => {
    const workspace = requireWorkspace(ctx)
    if (!claudeStatus().available) {
      throw new AppError(
        'CLAUDE_UNAVAILABLE',
        'CLI do Claude não encontrado — instale o Claude Code para perguntar ao Jiraiya'
      )
    }
    const prefs = getPrefs(ctx.db)
    const { snapshotJson } = buildAskContext(
      ctx.db,
      { id: workspace.id, account_id: workspace.account_id, site_url: workspace.site_url },
      prefs.stalledDays
    )
    try {
      const answer = await askJiraiya({
        question,
        history,
        snapshotJson,
        todayIso: new Date().toISOString().slice(0, 10),
        model: prefs.modelAsk
      })
      return { answer, generatedBy: 'claude' as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível responder com o Claude'
      throw new AppError('CLAUDE_UNAVAILABLE', message)
    }
  })

  // briefing: consulta o estado do briefing do dia (a geração roda em background)
  handle('briefing:today', () => {
    const stmt = ctx.db.prepare(`SELECT value_json FROM user_pref WHERE key = ?`)
    const read = (key: string): string | null =>
      (stmt.get(key) as { value_json: string } | undefined)?.value_json ?? null
    const lastDate = read('lastBriefingDate')
    const lastId = read('lastBriefingSummaryId')
    const today = new Date().toLocaleDateString('sv')
    if (lastDate === today && lastId !== null) {
      return { summaryId: Number(lastId) }
    }
    return { summaryId: null }
  })
}
