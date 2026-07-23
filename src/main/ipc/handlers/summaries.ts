import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs, deleteSummary, listSummaries, saveSummary } from '../../db/repos/misc'
import { buildPeriodDigest, collectPeriodComments } from '../../summaries/selectors'
import { templates } from '../../summaries/templates'
import { buildRetroDigest, renderRetroTemplate } from '../../summaries/retro'
import { claudeStatus, enhanceWithClaude } from '../../summaries/claude'
import { resolveWithSprint } from './issues'

export function registerSummaryHandlers(ctx: AppContext): void {
  handle('summaries:generate', async ({ period, template, useClaude }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')

    const range = resolveWithSprint(ctx, workspace.id, period)
    const prefs = getPrefs(ctx.db)
    const digest = buildPeriodDigest(ctx.db, workspace, range, prefs.stalledDays)
    const markdown = templates[template](digest)

    if (useClaude) {
      try {
        // comentários do período só entram no caminho do Claude (contexto real
        // de decisões/bloqueios/feedback); o template determinístico não muda
        const comentariosDoPeriodo = collectPeriodComments(ctx.db, workspace, range)
        const enhanced = await enhanceWithClaude({
          model: prefs.modelSummaries,
          templateMarkdown: markdown,
          digestJson: JSON.stringify({ ...digest, comentariosDoPeriodo }, null, 2)
        })
        return { markdown: enhanced, generatedBy: 'claude' as const }
      } catch {
        // fallback silencioso pro template — o renderer avisa via generatedBy
      }
    }
    return { markdown, generatedBy: 'template' as const }
  })

  handle('summaries:sprintRetro', async ({ sprintJiraId, useClaude }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')

    const digest = buildRetroDigest(
      { db: ctx.db, workspaceId: workspace.id, accountId: workspace.account_id },
      sprintJiraId
    )
    if (!digest) throw new AppError('NOT_FOUND', 'Sprint não encontrada')

    const markdown = renderRetroTemplate(digest)
    if (useClaude) {
      try {
        const comentariosDoPeriodo = collectPeriodComments(ctx.db, workspace, {
          start: digest.sprint.startDate,
          end: digest.sprint.endDate
        })
        const enhanced = await enhanceWithClaude({
          model: getPrefs(ctx.db).modelSummaries,
          templateMarkdown: markdown,
          digestJson: JSON.stringify({ ...digest, comentariosDoPeriodo }, null, 2)
        })
        return { markdown: enhanced, generatedBy: 'claude' as const }
      } catch {
        // fallback silencioso pro template — o renderer avisa via generatedBy
      }
    }
    return { markdown, generatedBy: 'template' as const }
  })

  handle('summaries:save', ({ period, template, contentMd, generatedBy }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    const range = resolveWithSprint(ctx, workspace.id, period)
    const id = saveSummary(ctx.db, workspace.id, {
      periodType: period.type,
      periodStart: range.start,
      periodEnd: range.end,
      template,
      contentMd,
      generatedBy
    })
    return { id }
  })

  handle('summaries:list', () => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) return { summaries: [] }
    return { summaries: listSummaries(ctx.db, workspace.id) }
  })

  handle('summaries:delete', ({ id }) => {
    const workspace = getWorkspaceRow(ctx.db)
    if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
    deleteSummary(ctx.db, workspace.id, id)
    return { ok: true as const }
  })

  handle('claude:status', () => claudeStatus())
}
