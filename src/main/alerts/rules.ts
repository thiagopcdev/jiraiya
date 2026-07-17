import type { AlertSeverity, Sprint } from '@shared/domain'
import type { AlertCandidate } from '../db/repos/misc'

/** Snapshot avaliado pelas regras (montado pelo engine a partir do DB). */
export interface AlertSnapshot {
  /** issues não concluídas */
  openIssues: Array<{
    key: string
    summary: string
    issueType: string | null
    status: string | null
    statusCategory: string | null
    priority: string | null
    assigneeAccountId: string | null
    descriptionText: string | null
    storyPoints: number | null
    sprintJiraId: number | null
    flagged: boolean
    updatedAt: string | null
  }>
  lastActivityByIssue: Map<string, string>
  activeSprint: Sprint | null
  stalledDays: number
  now: Date
}

export interface AlertRule {
  id: string
  severity: AlertSeverity
  evaluate: (snap: AlertSnapshot) => AlertCandidate[]
}

const short = (summary: string): string =>
  summary.length > 60 ? summary.slice(0, 57) + '…' : summary

export const rules: AlertRule[] = [
  {
    id: 'blocker',
    severity: 'critical',
    evaluate: (snap) =>
      snap.openIssues
        .filter((i) => i.flagged || i.priority === 'Highest' || i.priority === 'Blocker')
        .map((i) => ({
          ruleId: 'blocker',
          issueKey: i.key,
          severity: 'critical' as const,
          message: `${i.key} está marcado como bloqueador: ${short(i.summary)}`
        }))
  },
  {
    id: 'sem-descricao',
    severity: 'warning',
    evaluate: (snap) =>
      snap.openIssues
        .filter((i) => !i.descriptionText || i.descriptionText.trim().length < 10)
        .map((i) => ({
          ruleId: 'sem-descricao',
          issueKey: i.key,
          severity: 'warning' as const,
          message: `${i.key} está sem descrição: ${short(i.summary)}`
        }))
  },
  {
    id: 'sem-estimativa',
    severity: 'warning',
    evaluate: (snap) => {
      if (!snap.activeSprint) return []
      return snap.openIssues
        .filter(
          (i) =>
            i.sprintJiraId === snap.activeSprint!.jiraId &&
            i.storyPoints === null &&
            i.issueType !== null &&
            !/sub-?task|subtarefa|epic|épico/i.test(i.issueType)
        )
        .map((i) => ({
          ruleId: 'sem-estimativa',
          issueKey: i.key,
          severity: 'warning' as const,
          message: `${i.key} está na sprint ativa sem estimativa: ${short(i.summary)}`
        }))
    }
  },
  {
    id: 'in-progress-sem-assignee',
    severity: 'warning',
    evaluate: (snap) =>
      snap.openIssues
        .filter((i) => i.statusCategory === 'indeterminate' && i.assigneeAccountId === null)
        .map((i) => ({
          ruleId: 'in-progress-sem-assignee',
          issueKey: i.key,
          severity: 'warning' as const,
          message: `${i.key} está em andamento sem responsável: ${short(i.summary)}`
        }))
  },
  {
    id: 'parado-x-dias',
    severity: 'warning',
    evaluate: (snap) => {
      const cutoff = snap.now.getTime() - snap.stalledDays * 86400000
      return snap.openIssues
        .filter((i) => {
          if (i.statusCategory !== 'indeterminate') return false
          const last = snap.lastActivityByIssue.get(i.key) ?? i.updatedAt
          return last !== null && new Date(last).getTime() < cutoff
        })
        .map((i) => {
          const last = snap.lastActivityByIssue.get(i.key) ?? i.updatedAt!
          const dias = Math.floor((snap.now.getTime() - new Date(last).getTime()) / 86400000)
          return {
            ruleId: 'parado-x-dias',
            issueKey: i.key,
            severity: 'warning' as const,
            message: `${i.key} está parado há ${dias} dia(s): ${short(i.summary)}`
          }
        })
    }
  },
  {
    id: 'sprint-acabando',
    severity: 'critical',
    evaluate: (snap) => {
      const sprint = snap.activeSprint
      if (!sprint?.endDate) return []
      const msLeft = new Date(sprint.endDate).getTime() - snap.now.getTime()
      if (msLeft < 0 || msLeft > 2 * 86400000) return []
      const open = snap.openIssues.filter((i) => i.sprintJiraId === sprint.jiraId)
      if (open.length === 0) return []
      const dias = Math.ceil(msLeft / 86400000)
      return [
        {
          ruleId: 'sprint-acabando',
          issueKey: null,
          severity: 'critical' as const,
          message: `Sprint ${sprint.name ?? ''} termina em ${dias} dia(s) com ${open.length} issue(s) abertas`
        }
      ]
    }
  }
]
