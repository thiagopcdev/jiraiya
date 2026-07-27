import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getPrefs } from '../../db/repos/misc'
import { claudeStatus, runClaudePrompt, ClaudeUnavailableError } from '../../summaries/claude'
import { buildPolishPrompt, cleanPolishedText } from '../../issues/polish'

export function registerPolishHandlers(ctx: AppContext): void {
  handle('text:polish', async ({ text, context }) => {
    if (!claudeStatus().available) {
      throw new AppError(
        'CLAUDE_UNAVAILABLE',
        'CLI do Claude não encontrado — instale o Claude Code para melhorar o texto'
      )
    }
    const prefs = getPrefs(ctx.db)
    const model = context === 'description' ? prefs.modelDraft : prefs.modelComment
    try {
      const raw = await runClaudePrompt(buildPolishPrompt(text, context), model)
      const polished = cleanPolishedText(raw)
      if (polished === '') {
        throw new AppError('CLAUDE_UNAVAILABLE', 'O Claude devolveu uma resposta vazia')
      }
      return { text: polished, generatedBy: 'claude' as const }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message =
        err instanceof ClaudeUnavailableError || err instanceof Error
          ? err.message
          : 'Não foi possível melhorar o texto com o Claude'
      throw new AppError('CLAUDE_UNAVAILABLE', message)
    }
  })
}
