import type { Issue } from '@shared/domain'

export interface StatusGroup {
  status: string
  statusCategory: string | null
  issues: Issue[]
}

/**
 * Agrupa issues pelo status real do Jira, preservando a ordem de chegada.
 * Como as queries retornam por `updated_at` desc, o status com atividade mais
 * recente aparece primeiro — ordem natural, sem depender do workflow do time.
 */
export function groupByStatus(issues: Issue[]): StatusGroup[] {
  const map = new Map<string, StatusGroup>()
  for (const issue of issues) {
    const status = issue.status ?? 'Sem status'
    const group = map.get(status)
    if (group) {
      group.issues.push(issue)
    } else {
      map.set(status, { status, statusCategory: issue.statusCategory, issues: [issue] })
    }
  }
  return [...map.values()]
}
