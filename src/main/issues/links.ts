import type { JiraIssueLink, JiraLinkedIssue } from '../jira/types'

/** Um link de issue mapeado para o formato consumido pelo renderer. */
export interface MappedLink {
  label: string
  key: string
  summary: string | null
  status: string | null
  statusCategory: 'new' | 'indeterminate' | 'done' | null
}

/** Normaliza a categoria de status; valor fora do conjunto conhecido → null. */
function toCategory(key: string | undefined): 'new' | 'indeterminate' | 'done' | null {
  return key === 'new' || key === 'indeterminate' || key === 'done' ? key : null
}

function entryFor(linked: JiraLinkedIssue | undefined, label: string): MappedLink | null {
  if (!linked?.key) return null
  return {
    label,
    key: linked.key,
    summary: linked.fields?.summary ?? null,
    status: linked.fields?.status?.name ?? null,
    statusCategory: toCategory(linked.fields?.status?.statusCategory?.key)
  }
}

/**
 * Mapeia os links crus em uma entrada por link. `outwardIssue` usa o rótulo
 * outward (o card apontado); `inwardIssue` usa o rótulo inward. Link sem issue
 * de nenhum lado, ou cuja issue não tem key, é descartado.
 */
export function mapIssueLinks(raw: JiraIssueLink[]): MappedLink[] {
  const result: MappedLink[] = []
  for (const link of raw) {
    const type = link.type
    if (link.outwardIssue) {
      const entry = entryFor(link.outwardIssue, type?.outward ?? type?.name ?? 'relacionado')
      if (entry) result.push(entry)
      continue
    }
    if (link.inwardIssue) {
      const entry = entryFor(link.inwardIssue, type?.inward ?? type?.name ?? 'relacionado')
      if (entry) result.push(entry)
    }
  }
  return result
}
