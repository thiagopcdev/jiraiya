import { adfToText } from '../jira/adf'
import type { ActivityInsert } from '../db/repos/activity'
import type { JiraChangelogHistory, JiraComment, JiraIssue } from '../jira/types'

/**
 * Núcleo puro do produto: transforma changelog + comentários + criação
 * em linhas de IssueActivity dedupáveis por source_id.
 */
export function deriveActivities(input: {
  issue: Pick<JiraIssue, 'key' | 'fields'>
  changelog: JiraChangelogHistory[]
  comments: JiraComment[]
  storyPointsFieldId: string | null
}): ActivityInsert[] {
  const { issue, changelog, comments, storyPointsFieldId } = input
  const out: ActivityInsert[] = []

  // criação (sintética)
  if (issue.fields.created) {
    out.push({
      issueKey: issue.key,
      kind: 'created',
      actorAccountId: issue.fields.reporter?.accountId ?? null,
      actorName: issue.fields.reporter?.displayName ?? null,
      field: null,
      fromValue: null,
      toValue: null,
      bodyText: null,
      occurredAt: new Date(issue.fields.created).toISOString(),
      sourceId: `created:${issue.key}`
    })
  }

  for (const history of changelog) {
    const base = {
      issueKey: issue.key,
      actorAccountId: history.author?.accountId ?? null,
      actorName: history.author?.displayName ?? null,
      bodyText: null,
      occurredAt: new Date(history.created).toISOString()
    }
    history.items.forEach((item, idx) => {
      const sourceId = `changelog:${history.id}:${idx}`
      const fieldLower = item.field.toLowerCase()
      const common = {
        ...base,
        field: item.field,
        fromValue: item.fromString ?? item.from ?? null,
        toValue: item.toString ?? item.to ?? null
      }
      if (fieldLower === 'status') {
        out.push({ ...common, kind: 'status_change', sourceId })
      } else if (fieldLower === 'assignee') {
        out.push({ ...common, kind: 'assignment', sourceId })
      } else if (fieldLower === 'sprint') {
        out.push({ ...common, kind: 'sprint_change', sourceId })
      } else if (fieldLower === 'priority') {
        out.push({ ...common, kind: 'priority_change', sourceId })
      } else if (
        storyPointsFieldId !== null &&
        (item.fieldId === storyPointsFieldId ||
          fieldLower === 'story points' ||
          fieldLower === 'story point estimate')
      ) {
        out.push({ ...common, kind: 'estimate_change', sourceId })
      } else if (fieldLower === 'resolution' && (item.toString ?? item.to)) {
        out.push({ ...common, kind: 'resolved', sourceId })
      }
    })
  }

  for (const comment of comments) {
    out.push({
      issueKey: issue.key,
      kind: 'comment',
      actorAccountId: comment.author?.accountId ?? null,
      actorName: comment.author?.displayName ?? null,
      field: null,
      fromValue: null,
      toValue: null,
      bodyText: adfToText(comment.body),
      occurredAt: new Date(comment.created).toISOString(),
      sourceId: `comment:${comment.id}`
    })
  }

  return out
}
