import { JiraHttp } from './http'
import type { BoardTransition } from '../queries/board'
import type {
  AdfNode,
  JiraAgilePage,
  JiraAgileSprint,
  JiraAttachment,
  JiraAttachmentUploaded,
  JiraBoard,
  JiraBoardConfiguration,
  JiraBulkChangelogResponse,
  JiraChangelogHistory,
  JiraChangelogPageResponse,
  JiraComment,
  JiraCommentsResponse,
  JiraCreatedIssue,
  JiraCreateMetaIssueType,
  JiraCreateMetaIssueTypesResponse,
  JiraEditMetaResponse,
  JiraFieldDef,
  JiraIssue,
  JiraIssueLink,
  JiraIssueLinkTypesResponse,
  JiraMyself,
  JiraProject,
  JiraProjectSearchResponse,
  JiraSearchResponse,
  JiraStatus,
  JiraTransitionsResponse,
  JiraUserRef,
  JiraWorklog,
  JiraWorklogsResponse
} from './types'

/** Normaliza a categoria de status do Jira; valor desconhecido → 'new' (defensivo). */
function toCategoryKey(key: string | undefined): 'new' | 'indeterminate' | 'done' {
  return key === 'indeterminate' || key === 'done' ? key : 'new'
}

/** Teto de entradas de changelog buscadas por issue (as mais recentes). */
const CHANGELOG_MAX_ENTRIES = 300

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

  /**
   * Changelog de uma issue (fallback por issue quando o bulk não cobre, e fonte
   * do histórico exibido no card). Cards antigos têm changelog gigante, então há
   * teto de CHANGELOG_MAX_ENTRIES: como a API pagina do mais ANTIGO para o mais
   * novo, quando o total passa do teto a paginação é reposicionada na janela
   * final para trazer as entradas mais recentes.
   */
  async issueChangelog(issueKey: string): Promise<JiraChangelogHistory[]> {
    const all: JiraChangelogHistory[] = []
    let startAt = 0
    let rebased = false
    for (;;) {
      const res = await this.http.get<JiraChangelogPageResponse>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=100`
      )
      if (!rebased) {
        rebased = true
        if (res.total > CHANGELOG_MAX_ENTRIES) {
          startAt = res.total - CHANGELOG_MAX_ENTRIES
          continue
        }
      }
      all.push(...(res.values ?? []))
      // maxResults 0 travaria o loop — cai no tamanho pedido
      startAt += res.maxResults > 0 ? res.maxResults : 100
      if (startAt >= res.total || all.length >= CHANGELOG_MAX_ENTRIES) return all
    }
  }

  /**
   * Campos que a gaveta de detalhe lê ao vivo: descrição como ADF cru (null se
   * vazia) e relator. O relator vem junto de graça (mesmo GET) e cobre os cards
   * gravados antes da coluna `reporter_name`, que só é preenchida no sync.
   */
  async issueLiveFields(
    issueKey: string
  ): Promise<{ description: AdfNode | null; reporter: JiraUserRef | null }> {
    const res = await this.http.get<{
      fields?: { description?: AdfNode | null; reporter?: JiraUserRef | null }
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description,reporter`)
    return {
      description: res.fields?.description ?? null,
      reporter: res.fields?.reporter ?? null
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

  /** Anexos da issue (GET com fields=attachment). */
  async issueAttachments(
    issueKey: string
  ): Promise<Array<{ id: string; filename: string; mimeType: string | null; size: number }>> {
    const res = await this.http.get<{ fields?: { attachment?: JiraAttachment[] } }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`
    )
    return (res.fields?.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType ?? null,
      size: a.size
    }))
  }

  /**
   * Sobe um anexo na issue (multipart). O Jira responde com um ARRAY dos anexos
   * criados — devolve o primeiro.
   */
  async addAttachment(
    issueKey: string,
    filename: string,
    data: Buffer,
    mimeType: string | null
  ): Promise<JiraAttachmentUploaded> {
    const form = new FormData()
    // Buffer não é BlobPart no lib do TS deste projeto — passa o ArrayBuffer subjacente
    const bytes = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer
    form.append('file', new Blob([bytes], mimeType ? { type: mimeType } : undefined), filename)
    const res = await this.http.postForm<JiraAttachmentUploaded[]>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      form
    )
    const first = Array.isArray(res) ? res[0] : undefined
    if (!first) throw new Error('O Jira não devolveu o anexo criado')
    return first
  }

  /** Bytes da miniatura do anexo (redireciona p/ CDN assinada). */
  attachmentThumbnail(attachmentId: string): Promise<{ data: Buffer; mimeType: string | null }> {
    return this.http.getBytes(
      `/rest/api/3/attachment/thumbnail/${encodeURIComponent(attachmentId)}?redirect=true`
    )
  }

  /** Bytes do arquivo do anexo (redireciona p/ CDN assinada). */
  attachmentContent(attachmentId: string): Promise<{ data: Buffer; mimeType: string | null }> {
    return this.http.getBytes(
      `/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}?redirect=true`
    )
  }

  /** Edita um comentário existente. body em ADF (o chamador converte com textToAdf). */
  async updateComment(issueKey: string, commentId: string, body: unknown): Promise<void> {
    await this.http.put<unknown>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
      { body }
    )
  }

  /** Exclui um comentário (o Jira responde 204 sem corpo). */
  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    await this.http.delete(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`
    )
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

  /** Posta um comentário na issue. body em ADF (o chamador converte com textToAdf). */
  async addComment(issueKey: string, body: unknown): Promise<void> {
    await this.http.post<unknown>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      body
    })
  }

  /**
   * Configuração de colunas do board (nome + ids de status + limite de WIP por
   * coluna). `wipMax` vem de `max` só quando o board tem constraint configurada
   * na coluna — a maioria não tem, e nesse caso é `null`.
   */
  async boardConfiguration(
    boardId: number
  ): Promise<{ columns: Array<{ name: string; statusIds: string[]; wipMax: number | null }> }> {
    const res = await this.http.get<JiraBoardConfiguration>(
      `/rest/agile/1.0/board/${boardId}/configuration`
    )
    const columns = (res.columnConfig?.columns ?? []).map((c) => ({
      name: c.name ?? '',
      statusIds: (c.statuses ?? []).map((s) => s.id),
      wipMax: c.max ?? null
    }))
    return { columns }
  }

  /** Catálogo global de status do site (id → nome + categoria). */
  async listStatuses(): Promise<
    Array<{ id: string; name: string; categoryKey: 'new' | 'indeterminate' | 'done' }>
  > {
    const res = await this.http.get<JiraStatus[]>('/rest/api/3/status')
    return (res ?? []).map((s) => ({
      id: s.id,
      name: s.name ?? '',
      categoryKey: toCategoryKey(s.statusCategory?.key)
    }))
  }

  /** Transições disponíveis para a issue no estado atual. */
  async issueTransitions(issueKey: string): Promise<BoardTransition[]> {
    const res = await this.http.get<JiraTransitionsResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
    )
    return (res.transitions ?? []).map((t) => ({
      id: t.id,
      name: t.name ?? '',
      toStatusId: t.to?.id ?? '',
      toStatusName: t.to?.name ?? '',
      toCategoryKey: toCategoryKey(t.to?.statusCategory?.key)
    }))
  }

  /** Usuários atribuíveis à issue (filtra inativos, mapeia accountId/displayName). */
  async assignableUsers(
    issueKey: string
  ): Promise<Array<{ accountId: string; displayName: string }>> {
    const res = await this.http.get<
      Array<{ accountId: string; displayName?: string; active?: boolean }>
    >(`/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(issueKey)}&maxResults=50`)
    return (res ?? [])
      .filter((u) => u.active !== false)
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName ?? u.accountId }))
  }

  /** Links de issue crus (fields.issuelinks). */
  async issueLinks(issueKey: string): Promise<JiraIssueLink[]> {
    const res = await this.http.get<{ fields?: { issuelinks?: JiraIssueLink[] } }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=issuelinks`
    )
    return res.fields?.issuelinks ?? []
  }

  /** Executa uma transição na issue. */
  async doTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.http.post<unknown>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: { id: transitionId }
    })
  }

  /** Metadados de edição da issue (campos editáveis + valores permitidos). */
  issueEditMeta(issueKey: string): Promise<JiraEditMetaResponse> {
    return this.http.get<JiraEditMetaResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/editmeta`
    )
  }

  /** Edita campos da issue (PUT — o Jira responde 204 sem corpo). */
  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.http.put<unknown>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, { fields })
  }

  /** Registra um worklog na issue. commentAdf em ADF (o chamador converte). */
  async addWorklog(issueKey: string, timeSpent: string, commentAdf?: unknown): Promise<void> {
    await this.http.post<unknown>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`, {
      timeSpent,
      ...(commentAdf !== undefined ? { comment: commentAdf } : {})
    })
  }

  /** Worklogs da issue (até 100; body.worklogs). */
  async listWorklogs(issueKey: string): Promise<JiraWorklog[]> {
    const res = await this.http.get<JiraWorklogsResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?maxResults=100`
    )
    return res.worklogs ?? []
  }

  /** Edita um worklog. commentAdf em ADF (o chamador converte). */
  async updateWorklog(
    issueKey: string,
    worklogId: string,
    timeSpent: string,
    commentAdf?: unknown
  ): Promise<void> {
    await this.http.put<unknown>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`,
      { timeSpent, ...(commentAdf !== undefined ? { comment: commentAdf } : {}) }
    )
  }

  /** Exclui um worklog (o Jira responde 204 sem corpo). */
  async deleteWorklog(issueKey: string, worklogId: string): Promise<void> {
    await this.http.delete(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`
    )
  }

  /** Tipos de vínculo entre issues do site (id + rótulos inward/outward). */
  async listIssueLinkTypes(): Promise<
    Array<{ id: string; name: string; inward: string; outward: string }>
  > {
    const res = await this.http.get<JiraIssueLinkTypesResponse>('/rest/api/3/issueLinkType')
    return (res.issueLinkTypes ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      inward: t.inward,
      outward: t.outward
    }))
  }

  /** Cria um vínculo entre duas issues (typeName = nome do tipo, ex. 'Blocks'). */
  async createIssueLink(typeName: string, inwardKey: string, outwardKey: string): Promise<void> {
    await this.http.post<unknown>('/rest/api/3/issueLink', {
      type: { name: typeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey }
    })
  }

  /** Move issues para uma sprint (Agile). */
  async moveIssuesToSprint(sprintJiraId: number, issueKeys: string[]): Promise<void> {
    await this.http.post<unknown>(`/rest/agile/1.0/sprint/${sprintJiraId}/issue`, {
      issues: issueKeys
    })
  }

  /** Move issues de volta ao backlog (Agile). */
  async moveIssuesToBacklog(issueKeys: string[]): Promise<void> {
    await this.http.post<unknown>('/rest/agile/1.0/backlog/issue', { issues: issueKeys })
  }

  /** Tempo gasto / estimativa original da issue (campo timetracking). */
  async issueTimeTracking(
    issueKey: string
  ): Promise<{ timeSpent: string | null; originalEstimate: string | null }> {
    const res = await this.http.get<{
      fields?: { timetracking?: { timeSpent?: string; originalEstimate?: string } }
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=timetracking`)
    const tt = res.fields?.timetracking
    return {
      timeSpent: tt?.timeSpent ?? null,
      originalEstimate: tt?.originalEstimate ?? null
    }
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
