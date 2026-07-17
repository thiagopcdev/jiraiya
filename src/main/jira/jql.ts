/**
 * Builders de JQL. Datas no formato "yyyy-MM-dd HH:mm" interpretadas pelo Jira
 * no timezone do usuário autenticado — por isso convertemos a partir do
 * timezone do workspace.
 */

export function formatJqlDate(iso: string, timeZone: string | null): string {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`
}

const OVERLAP_MS = 10 * 60 * 1000

export interface SyncJqlOpts {
  mode: 'project' | 'personal'
  projectKeys: string[]
  /** ISO do cursor (última issue processada); null = backfill */
  cursor: string | null
  backfillDays: number
  timeZone: string | null
}

export function buildSyncJql(opts: SyncJqlOpts): string {
  const scope =
    opts.mode === 'project' && opts.projectKeys.length > 0
      ? `project IN (${opts.projectKeys.map((k) => JSON.stringify(k)).join(', ')})`
      : `(assignee = currentUser() OR assignee WAS currentUser() OR reporter = currentUser())`

  let updatedClause: string
  if (opts.cursor) {
    const from = new Date(new Date(opts.cursor).getTime() - OVERLAP_MS).toISOString()
    updatedClause = `updated >= "${formatJqlDate(from, opts.timeZone)}"`
  } else {
    updatedClause = `updated >= -${opts.backfillDays}d`
  }

  return `${scope} AND ${updatedClause} ORDER BY updated ASC`
}
