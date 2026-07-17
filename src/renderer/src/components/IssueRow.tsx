import { ExternalLink } from 'lucide-react'
import type { Issue } from '@shared/domain'
import { invoke } from '../api/client'
import { Badge, statusColor } from './ui'

export function IssueRow({ issue }: { issue: Issue }): React.JSX.Element {
  return (
    <button
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/70"
      onClick={() => void invoke('shell:openIssue', { issueKey: issue.key })}
      title={`Abrir ${issue.key} no Jira`}
    >
      <span className="shrink-0 font-mono text-xs text-zinc-500">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{issue.summary}</span>
      {issue.storyPoints !== null && <Badge color="indigo">{issue.storyPoints}</Badge>}
      {issue.status && <Badge color={statusColor(issue.statusCategory)}>{issue.status}</Badge>}
      <ExternalLink
        size={13}
        className="shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  )
}
