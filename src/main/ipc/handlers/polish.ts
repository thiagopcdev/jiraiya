import { AppError, handle } from '../registry'
import { activeProvider, runAiPrompt } from '../../ai/service'
import { AiUnavailableError } from '../../ai/types'
import { buildPolishPrompt, cleanPolishedText } from '../../issues/polish'

/** Sem ctx: o modelo vem do registry de IA, não mais dos prefs legados. */
export function registerPolishHandlers(): void {
  handle('text:polish', async ({ text, context }) => {
    const provider = activeProvider()
    if (!provider) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'Nenhum provider de IA disponível — configure em Ajustes'
      )
    }
    // o polimento herda o modelo da função correspondente (descrição → draft, comentário → comment)
    const feature = context === 'description' ? 'draft' : 'comment'
    try {
      const raw = await runAiPrompt(feature, buildPolishPrompt(text, context))
      const polished = cleanPolishedText(raw)
      if (polished === '') {
        throw new AppError('AI_UNAVAILABLE', `Resposta vazia (${provider.label})`)
      }
      return { text: polished, generatedBy: provider.id }
    } catch (err) {
      if (err instanceof AppError) throw err
      const message =
        err instanceof AiUnavailableError || err instanceof Error
          ? err.message
          : `Não foi possível melhorar o texto (${provider.label})`
      throw new AppError('AI_UNAVAILABLE', message)
    }
  })
}
