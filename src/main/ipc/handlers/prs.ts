import { handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getPrefs } from '../../db/repos/misc'
import { ghAvailable } from '../../gh/gh'
import { prsForIssue } from '../../gh/prs'

export function registerPrHandlers(ctx: AppContext): void {
  handle('prs:status', () => {
    return { ghAvailable: ghAvailable(), enabled: getPrefs(ctx.db).prIntegration }
  })

  handle('prs:forIssue', async ({ key }) => {
    const prefs = getPrefs(ctx.db)
    if (!prefs.prIntegration || !ghAvailable()) {
      return { available: false, prs: [] }
    }
    try {
      const prs = await prsForIssue(key, prefs.prSearchScope)
      return { available: true, prs }
    } catch {
      // integração é opcional e silenciosa — nunca lança
      return { available: false, prs: [] }
    }
  })
}
