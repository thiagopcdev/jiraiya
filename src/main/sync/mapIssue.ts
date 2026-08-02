import { adfToText } from '../jira/adf'
import type { IssueUpsert } from '../db/repos/issue'
import type { AdfNode, JiraIssue, JiraSprintValue } from '../jira/types'

/** Converte a issue crua da API no shape de upsert do banco. */
export function mapIssue(
  raw: JiraIssue,
  fieldIds: {
    storyPointsFieldId: string | null
    sprintFieldId: string | null
    flaggedFieldId: string | null
  }
): IssueUpsert {
  const f = raw.fields

  let storyPoints: number | null = null
  if (fieldIds.storyPointsFieldId) {
    const v = f[fieldIds.storyPointsFieldId]
    if (typeof v === 'number') storyPoints = v
  }

  let sprintJiraId: number | null = null
  if (fieldIds.sprintFieldId) {
    const v = f[fieldIds.sprintFieldId]
    if (Array.isArray(v) && v.length > 0) {
      const sprints = v as JiraSprintValue[]
      const active = sprints.find((s) => s.state === 'active')
      sprintJiraId = (active ?? sprints[sprints.length - 1])?.id ?? null
    }
  }

  // "Flagged" vem como array de opções ([{value: 'Impediment'}]); vazio/ausente = sem flag
  let flagged = false
  if (fieldIds.flaggedFieldId) {
    const v = f[fieldIds.flaggedFieldId]
    flagged = Array.isArray(v) && v.length > 0
  }

  const descriptionText = f.description ? adfToText(f.description as AdfNode) : null

  return {
    jiraId: raw.id,
    key: raw.key,
    projectKey: f.project?.key ?? raw.key.split('-')[0],
    summary: f.summary ?? '',
    descriptionText: descriptionText && descriptionText.length > 0 ? descriptionText : null,
    issueType: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    statusCategory: f.status?.statusCategory?.key ?? null,
    priority: f.priority?.name ?? null,
    assigneeAccountId: f.assignee?.accountId ?? null,
    assigneeName: f.assignee?.displayName ?? null,
    reporterAccountId: f.reporter?.accountId ?? null,
    reporterName: f.reporter?.displayName ?? null,
    storyPoints,
    sprintJiraId,
    labels: f.labels ?? [],
    parentKey: f.parent?.key ?? null,
    flagged,
    createdAt: f.created ? new Date(f.created).toISOString() : null,
    updatedAt: f.updated ? new Date(f.updated).toISOString() : null,
    resolvedAt: f.resolutiondate ? new Date(f.resolutiondate).toISOString() : null
  }
}
