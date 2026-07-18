import { JiraHttp } from './http'
import type {
  JiraAgilePage,
  JiraAgileSprint,
  JiraBoard,
  JiraBulkChangelogResponse,
  JiraChangelogHistory,
  JiraChangelogPageResponse,
  JiraComment,
  JiraCommentsResponse,
  JiraCreatedIssue,
  JiraCreateMetaIssueType,
  JiraCreateMetaIssueTypesResponse,
  JiraFieldDef,
  JiraIssue,
  JiraMyself,
  JiraProject,
  JiraProjectSearchResponse,
  JiraSearchResponse
} from './types'

const BASE_FIELDS = [
  'summary',
  'description',
  'issuetype',
  'status',
  'priority',
  'assignee',
  'reporter',
  'created',
  'updated',
  'resolutiondate',
  'labels',
  'parent',
  'project'
]

export class JiraClient {
  constructor(private readonly http: JiraHttp) {}

  myself(): Promise<JiraMyself> {
    return this.http.get<JiraMyself>('/rest/api/3/myself')
  }

  listFields(): Promise<JiraFieldDef[]> {
    return this.http.get<JiraFieldDef[]>('/rest/api/3/field')
  }

  /**
   * Busca paginada via POST /rest/api/3/search/jql (o /search antigo foi removido).
   * Chama onPage por página; retorna o total de issues processadas.
   */
  async searchAll(
    jql: string,
    customFieldIds: string[],
    onPage: (issues: JiraIssue[]) => Promise<void> | void
  ): Promise<number> {
    const fields = [...BASE_FIELDS, ...customFieldIds]
    let nextPageToken: string | undefined
    let total = 0
    for (;;) {
      const res = await this.http.post<JiraSearchResponse>('/rest/api/3/search/jql', {
        jql,
        fields,
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {})
      })
      const issues = res.issues ?? []
      total += issues.length
      if (issues.length > 0) await onPage(issues)
      if (!res.nextPageToken || issues.length === 0) return total
      nextPageToken = res.nextPageToken
    }
  }

  /** Changelogs em lote (até 1000 issues por request, paginado por token). */
  async bulkChangelogs(issueKeys: string[]): Promise<Map<string, JiraChangelogHistory[]>> {
    const result = new Map<string, JiraChangelogHistory[]>()
    for (let i = 0; i < issueKeys.length; i += 500) {
      const batch = issueKeys.slice(i, i + 500)
      let nextPageToken: string | undefined
      for (;;) {
        const res = await this.http.post<JiraBulkChangelogResponse>(
          '/rest/api/3/changelog/bulkfetch',
          {
            issueIdsOrKeys: batch,
            maxResults: 1000,
            ...(nextPageToken ? { nextPageToken } : {})
          }
        )
        for (const entry of res.issueChangeLogs ?? []) {
          const existing = result.get(entry.issueId) ?? []
          result.set(entry.issueId, existing.concat(entry.changeHistories ?? []))
        }
        if (!res.nextPageToken) break
        nextPageToken = res.nextPageToken
      }
    }
    return result
  }

  /** Fallback por issue quando o bulk não cobre (changelogs muito grandes). */
  async issueChangelog(issueKey: string): Promise<JiraChangelogHistory[]> {
    const all: JiraChangelogHistory[] = []
    let startAt = 0
    for (;;) {
      const res = await this.http.get<JiraChangelogPageResponse>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=100`
      )
      all.push(...(res.values ?? []))
      startAt += res.maxResults
      if (startAt >= res.total) return all
    }
  }

  async issueComments(issueKey: string): Promise<JiraComment[]> {
    const all: JiraComment[] = []
    let startAt = 0
    for (;;) {
      const res = await this.http.get<JiraCommentsResponse>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created&startAt=${startAt}&maxResults=50`
      )
      all.push(...(res.comments ?? []))
      startAt += res.maxResults
      if (startAt >= res.total) return all
    }
  }

  async listProjects(): Promise<JiraProject[]> {
    const all: JiraProject[] = []
    let startAt = 0
    for (;;) {
      const res = await this.http.get<JiraProjectSearchResponse>(
        `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=key`
      )
      all.push(...(res.values ?? []))
      if (res.isLast !== false || res.values.length === 0) return all
      startAt += res.maxResults
    }
  }

  async listBoards(projectKey: string): Promise<JiraBoard[]> {
    const all: JiraBoard[] = []
    let startAt = 0
    for (;;) {
      const res = await this.http.get<JiraAgilePage<JiraBoard>>(
        `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&startAt=${startAt}&maxResults=50`
      )
      all.push(...(res.values ?? []))
      if (res.isLast !== false || res.values.length === 0) return all
      startAt += res.maxResults
    }
  }

  async listSprints(boardId: number): Promise<JiraAgileSprint[]> {
    const all: JiraAgileSprint[] = []
    let startAt = 0
    for (;;) {
      let res: JiraAgilePage<JiraAgileSprint>
      try {
        res = await this.http.get<JiraAgilePage<JiraAgileSprint>>(
          `/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&startAt=${startAt}&maxResults=50`
        )
      } catch {
        // boards Kanban não têm sprints (400) — ignora
        return all
      }
      all.push(...(res.values ?? []))
      if (res.isLast !== false || res.values.length === 0) return all
      startAt += res.maxResults
    }
  }

  /**
   * Tipos de issue criáveis num projeto via createmeta novo
   * (`/issue/createmeta/{key}/issuetypes` — o `/issue/createmeta` antigo foi removido).
   * Pagina acumulando até coletados >= total ou página vazia (guarda contra loop).
   */
  async listCreateIssueTypes(projectKey: string): Promise<JiraCreateMetaIssueType[]> {
    const all: JiraCreateMetaIssueType[] = []
    let startAt = 0
    for (;;) {
      const res = await this.http.get<JiraCreateMetaIssueTypesResponse>(
        `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?startAt=${startAt}&maxResults=50`
      )
      const page = res.issueTypes ?? []
      all.push(...page)
      if (page.length === 0 || all.length >= res.total) return all
      startAt += page.length
    }
  }

  createIssue(fields: Record<string, unknown>): Promise<JiraCreatedIssue> {
    return this.http.post<JiraCreatedIssue>('/rest/api/3/issue', { fields })
  }
}

export function discoverCustomFields(fields: JiraFieldDef[]): {
  storyPointsFieldId: string | null
  sprintFieldId: string | null
  flaggedFieldId: string | null
} {
  const byName = (names: string[]): JiraFieldDef | undefined =>
    fields.find((f) => f.custom && names.includes(f.name.toLowerCase()))

  const storyPoints =
    byName(['story point estimate', 'story points', 'pontos de história', 'pontos de historia']) ??
    fields.find((f) => f.schema?.custom?.endsWith(':storypoint') ?? false)

  const sprint =
    fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint') ??
    byName(['sprint'])

  // "Flagged" (impedimento) é um multicheckbox custom; o nome varia por locale
  const flagged =
    fields.find(
      (f) =>
        f.schema?.custom === 'com.atlassian.jira.plugin.system.customfieldtypes:multicheckboxes' &&
        /flag|impedimento|sinaliz/i.test(f.name)
    ) ?? byName(['flagged'])

  return {
    storyPointsFieldId: storyPoints?.id ?? null,
    sprintFieldId: sprint?.id ?? null,
    flaggedFieldId: flagged?.id ?? null
  }
}
