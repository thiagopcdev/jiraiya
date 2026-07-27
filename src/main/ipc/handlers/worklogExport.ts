import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { adfToText } from '../../jira/adf'
import type { JiraIssue } from '../../jira/types'
import { JiraHttpError } from '../../jira/http'

/** Teto de issues consideradas no export (uma quinzena raramente passa disso). */
const MAX_ISSUES = 100

interface ExportRow {
  date: string
  key: string
  summary: string
  timeSpent: string
  seconds: number
  comment: string | null
}

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

/** Sinaliza que já acumulamos issues suficientes e o loop de páginas deve parar. */
class StopPaging extends Error {}

export function registerWorklogExportHandlers(ctx: AppContext): void {
  handle('worklog:export', async ({ start, end }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)

    const jql = `worklogAuthor = currentUser() AND worklogDate >= "${start}" AND worklogDate <= "${end}"`

    const candidates: Array<{ key: string; summary: string }> = []
    try {
      await client.searchAll(jql, [], (page: JiraIssue[]) => {
        for (const issue of page) {
          candidates.push({ key: issue.key, summary: issue.fields?.summary ?? issue.key })
        }
        if (candidates.length >= MAX_ISSUES) throw new StopPaging()
      })
    } catch (err) {
      if (!(err instanceof StopPaging)) {
        if (err instanceof JiraHttpError && err.status === 400) {
          throw new AppError('JQL_INVALID', 'O Jira recusou a busca de worklogs do período')
        }
        throw err
      }
    }

    // intervalo fechado, em horário LOCAL
    const startMs = new Date(`${start}T00:00:00`).getTime()
    const endMs = new Date(`${end}T23:59:59.999`).getTime()

    const rows: ExportRow[] = []
    for (const issue of candidates.slice(0, MAX_ISSUES)) {
      let worklogs
      try {
        worklogs = await client.listWorklogs(issue.key)
      } catch {
        // uma issue inacessível (permissão, 404 pós-move) não derruba o export
        continue
      }
      for (const w of worklogs) {
        if (w.author?.accountId !== workspace.account_id) continue
        const startedMs = new Date(w.started).getTime()
        if (Number.isNaN(startedMs) || startedMs < startMs || startedMs > endMs) continue
        const comment = adfToText(w.comment)
        rows.push({
          date: w.started,
          key: issue.key,
          summary: issue.summary,
          timeSpent: w.timeSpent,
          seconds: w.timeSpentSeconds,
          comment: comment === '' ? null : comment
        })
      }
    }

    // ordena pelo instante real (o started vem com offset do fuso, não dá para comparar texto)
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0)
    return { rows, totalSeconds }
  })
}
