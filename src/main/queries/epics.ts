import type Database from 'better-sqlite3'
import type { StatusCategory } from '@shared/domain'

/** Panorama de um épico: progresso de filhos por contagem e por story points. */
export interface EpicOverview {
  key: string
  summary: string
  status: string | null
  statusCategory: StatusCategory | null
  url: string
  total: number
  done: number
  spTotal: number
  spDone: number
}

function browseUrl(siteUrl: string, key: string): string {
  return `${siteUrl.replace(/\/$/, '')}/browse/${key}`
}

/** Parte numérica de uma key ('BT-123' → 123); 0 se não houver. */
function keyNumber(key: string): number {
  const m = key.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : 0
}

interface Row {
  key: string
  summary: string
  status: string | null
  status_category: string | null
  total: number
  done: number
  spTotal: number
  spDone: number
}

/**
 * Épicos do workspace (issue_type case-insensitive 'epic'/'épico') com progresso
 * dos filhos (parent_key = key). Épicos sem filhos aparecem com zeros.
 * Ordenação: não-concluídos primeiro, depois por parte numérica da key DESC.
 */
export function epicsOverview(
  db: Database.Database,
  workspaceId: number,
  siteUrl: string
): EpicOverview[] {
  const rows = db
    .prepare(
      `SELECT e.key AS key, e.summary AS summary, e.status AS status,
              e.status_category AS status_category,
              COUNT(c.id) AS total,
              SUM(CASE WHEN c.status_category = 'done' THEN 1 ELSE 0 END) AS done,
              COALESCE(SUM(c.story_points), 0) AS spTotal,
              COALESCE(SUM(CASE WHEN c.status_category = 'done' THEN c.story_points ELSE 0 END), 0) AS spDone
       FROM issue e
       LEFT JOIN issue c ON c.parent_key = e.key AND c.workspace_id = e.workspace_id
       -- LOWER do SQLite só rebaixa ASCII: 'Épico'/'ÉPICO' viram 'Épico', daí a 3ª variante
       WHERE e.workspace_id = ? AND LOWER(e.issue_type) IN ('epic', 'épico', 'Épico')
       GROUP BY e.id`
    )
    .all(workspaceId) as Row[]

  const epics: EpicOverview[] = rows.map((r) => ({
    key: r.key,
    summary: r.summary,
    status: r.status,
    statusCategory: (r.status_category as StatusCategory | null) ?? null,
    url: browseUrl(siteUrl, r.key),
    total: r.total,
    done: r.done,
    spTotal: r.spTotal,
    spDone: r.spDone
  }))

  epics.sort((a, b) => {
    const aDone = a.statusCategory === 'done' ? 1 : 0
    const bDone = b.statusCategory === 'done' ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    return keyNumber(b.key) - keyNumber(a.key)
  })

  return epics
}
