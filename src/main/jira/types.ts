/** Tipos crus (parciais) das respostas da API do Jira Cloud v3 / Agile 1.0. */

export interface AdfNode {
  type: string
  text?: string
  content?: AdfNode[]
  attrs?: Record<string, unknown>
  // attrs opcional no mark: usado por link (href); marcas simples (strong/em/code) omitem
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  version?: number
}

export interface JiraCreateMetaIssueType {
  id: string
  name: string
  subtask?: boolean
}

export interface JiraCreateMetaIssueTypesResponse {
  startAt: number
  maxResults: number
  total: number
  issueTypes: JiraCreateMetaIssueType[]
}

export interface JiraCreatedIssue {
  id: string
  key: string
  self: string
}

export interface JiraMyself {
  accountId: string
  displayName: string
  emailAddress?: string
  timeZone?: string
}

export interface JiraFieldDef {
  id: string
  name: string
  custom: boolean
  schema?: { type?: string; custom?: string }
}

export interface JiraUserRef {
  accountId: string
  displayName?: string
}

export interface JiraSprintValue {
  id: number
  name?: string
  state?: string
  boardId?: number
  startDate?: string
  endDate?: string
  completeDate?: string
}

export interface JiraIssueFields {
  summary: string
  description?: AdfNode | null
  issuetype?: { name?: string }
  status?: { name?: string; statusCategory?: { key?: string } }
  priority?: { name?: string }
  assignee?: JiraUserRef | null
  reporter?: JiraUserRef | null
  created?: string
  updated?: string
  resolutiondate?: string | null
  labels?: string[]
  parent?: { key?: string }
  project?: { key?: string }
  // campos custom (story points, sprint) acessados dinamicamente
  [custom: string]: unknown
}

export interface JiraIssue {
  id: string
  key: string
  fields: JiraIssueFields
}

export interface JiraSearchResponse {
  issues: JiraIssue[]
  nextPageToken?: string
  isLast?: boolean
}

export interface JiraChangelogItem {
  field: string
  fieldId?: string
  fromString?: string | null
  toString?: string | null
  from?: string | null
  to?: string | null
}

export interface JiraChangelogHistory {
  id: string
  author?: JiraUserRef
  created: string
  items: JiraChangelogItem[]
}

export interface JiraBulkChangelogResponse {
  issueChangeLogs: Array<{
    issueId: string
    changeHistories: JiraChangelogHistory[]
  }>
  nextPageToken?: string
}

export interface JiraChangelogPageResponse {
  values: JiraChangelogHistory[]
  startAt: number
  maxResults: number
  total: number
}

export interface JiraComment {
  id: string
  author?: JiraUserRef
  body?: AdfNode | null
  created: string
  updated?: string
}

export interface JiraCommentsResponse {
  comments: JiraComment[]
  startAt: number
  maxResults: number
  total: number
}

/** Um item de fields.attachment. */
export interface JiraAttachment {
  id: string
  filename: string
  mimeType?: string | null
  size: number
  thumbnail?: string
  content?: string
}

/** Um item da resposta de POST /rest/api/3/issue/{key}/attachments (array). */
export interface JiraAttachmentUploaded {
  id: string
  filename: string
  mimeType?: string | null
  size: number
}

export interface JiraProject {
  id: string
  key: string
  name: string
  avatarUrls?: Record<string, string>
}

export interface JiraProjectSearchResponse {
  values: JiraProject[]
  startAt: number
  maxResults: number
  total: number
  isLast?: boolean
}

export interface JiraBoard {
  id: number
  name?: string
  type?: string
  location?: { projectKey?: string }
}

export interface JiraAgilePage<T> {
  values: T[]
  startAt: number
  maxResults: number
  isLast?: boolean
}

export interface JiraAgileSprint {
  id: number
  name?: string
  state?: string
  startDate?: string
  endDate?: string
  completeDate?: string
  originBoardId?: number
}

/** GET /rest/agile/1.0/board/{id}/configuration */
export interface JiraBoardConfiguration {
  columnConfig?: {
    columns?: Array<{
      name?: string
      statuses?: Array<{ id: string; self?: string }>
      // presentes só quando a coluna tem constraint de WIP configurada no board
      min?: number
      max?: number
    }>
  }
}

/** GET /rest/api/3/status */
export interface JiraStatus {
  id: string
  name?: string
  statusCategory?: { key?: string }
}

/** GET /rest/api/3/issue/{key}/editmeta */
export interface JiraEditMetaResponse {
  fields?: Record<
    string,
    {
      name?: string
      allowedValues?: Array<{ id?: string; name?: string; value?: string }>
    }
  >
}

/** Issue vinculada (lado inward/outward de um issuelink). */
export interface JiraLinkedIssue {
  key?: string
  fields?: {
    summary?: string
    status?: { name?: string; statusCategory?: { key?: string } }
  }
}

/** Um item de fields.issuelinks. */
export interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string }
  outwardIssue?: JiraLinkedIssue
  inwardIssue?: JiraLinkedIssue
}

/** Um item de worklogs (GET /rest/api/3/issue/{key}/worklog). */
export interface JiraWorklog {
  id: string
  author?: { accountId?: string; displayName?: string } | null
  started: string
  timeSpent: string
  timeSpentSeconds: number
  comment?: AdfNode | null
}

/** GET /rest/api/3/issue/{key}/worklog */
export interface JiraWorklogsResponse {
  worklogs?: JiraWorklog[]
  startAt?: number
  maxResults?: number
  total?: number
}

/** GET /rest/api/3/issueLinkType */
export interface JiraIssueLinkTypesResponse {
  issueLinkTypes?: Array<{ id: string; name: string; inward: string; outward: string }>
}

/** GET /rest/api/3/issue/{key}/transitions */
export interface JiraTransitionsResponse {
  transitions?: Array<{
    id: string
    name?: string
    to?: {
      id?: string
      name?: string
      statusCategory?: { key?: string }
    }
  }>
}
