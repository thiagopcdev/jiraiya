import type { Issue } from '@shared/domain'
import { invoke } from '../api/client'
import { Badge } from './ui'
import { groupByStatus } from './groupByStatus'

/**
 * Lista de issues subagrupada pelo status real (ex.: "Pronto para teste (4)",
 * "Em teste (1)"). Usada onde um único status-category do Jira esconde vários
 * status distintos — como o "em andamento".
 */
export function IssuesByStatus({ issues }: { issues: Issue[] }): React.JSX.Element {
  const groups = groupByStatus(issues)
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.status}>
          <div className="mb-0.5 px-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {group.status} <span className="text-zinc-600">({group.issues.length})</span>
          </div>
          <div className="space-y-0.5">
            {group.issues.map((issue) => (
              <IssueLine key={issue.key} issue={issue} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function IssueLine({ issue }: { issue: Issue }): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-800/70"
      onClick={() => void invoke('shell:openIssue', { issueKey: issue.key })}
      title={`Abrir ${issue.key} no Jira`}
    >
      <span className="shrink-0 font-mono text-xs text-zinc-500">{issue.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{issue.summary}</span>
      {issue.storyPoints !== null && <Badge color="indigo">{issue.storyPoints}</Badge>}
    </button>
  )
}
