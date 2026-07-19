import { ExternalLink } from 'lucide-react'
import type { Issue } from '@shared/domain'
import { invoke } from '../api/client'
import { Badge } from './ui'
import { statusColor } from './statusColor'
import { useIssueDetail } from './issueDetail'

export function IssueRow({ issue }: { issue: Issue }): React.JSX.Element {
  const { openIssue } = useIssueDetail()

  return (
    <button
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/70"
      onClick={() => openIssue(issue.key)}
      title={issue.key}
    >
      <span className="shrink-0 font-mono text-xs text-zinc-500">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{issue.summary}</span>
      {issue.storyPoints !== null && <Badge color="indigo">{issue.storyPoints}</Badge>}
      {issue.status && <Badge color={statusColor(issue.statusCategory)}>{issue.status}</Badge>}
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300"
        title={`Abrir ${issue.key} no Jira`}
        onClick={(e) => {
          e.stopPropagation()
          void invoke('shell:openIssue', { issueKey: issue.key })
        }}
      >
        <ExternalLink size={13} />
      </span>
    </button>
  )
}
