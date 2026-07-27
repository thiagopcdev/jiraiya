import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { searchGlobal } from './search'

const SITE_URL = 'https://x.atlassian.net'

function insertWorkspace(db: Database.Database, id: number, siteUrl: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, @siteUrl, 'e@x.com', 'acc', 'now')`
  ).run({ id, siteUrl })
}

function insertIssue(
  db: Database.Database,
  workspaceId: number,
  opts: {
    key: string
    summary: string
    descriptionText?: string | null
    status?: string
    statusCategory?: string
  }
): void {
  db.prepare(
    `INSERT INTO issue (
      workspace_id, jira_id, key, project_key, summary, description_text, status, status_category
    ) VALUES (@workspaceId, @key, @key, 'BT', @summary, @descriptionText, @status, @statusCategory)`
  ).run({
    workspaceId,
    key: opts.key,
    summary: opts.summary,
    descriptionText: opts.descriptionText ?? null,
    status: opts.status ?? 'To Do',
    statusCategory: opts.statusCategory ?? 'new'
  })
}

let commentSeq = 0
function insertComment(
  db: Database.Database,
  workspaceId: number,
  issueKey: string,
  bodyText: string
): void {
  commentSeq++
  db.prepare(
    `INSERT INTO issue_activity (workspace_id, issue_key, kind, body_text, occurred_at, source_id)
     VALUES (?, ?, 'comment', ?, ?, ?)`
  ).run(workspaceId, issueKey, bodyText, new Date().toISOString(), `comment-${commentSeq}`)
}

describe('searchGlobal', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1, SITE_URL)
  })

  it('match por summary -> match "title", snippet null, url de browse correta', () => {
    insertIssue(db, 1, { key: 'BT-1', summary: 'Corrigir bug de login' })

    const results = searchGlobal(db, 1, SITE_URL, 'login')

    expect(results).toEqual([
      {
        key: 'BT-1',
        summary: 'Corrigir bug de login',
        status: 'To Do',
        statusCategory: 'new',
        url: `${SITE_URL}/browse/BT-1`,
        snippet: null,
        match: 'title'
      }
    ])
  })

  it('match só na description_text -> match "description", snippet não-nulo com delimitadores 「」', () => {
    insertIssue(db, 1, {
      key: 'BT-2',
      summary: 'Card sem o termo no título',
      descriptionText: 'Precisamos revisar o webhook de pagamento amanhã'
    })

    const results = searchGlobal(db, 1, SITE_URL, 'webhook')

    expect(results).toHaveLength(1)
    expect(results[0].match).toBe('description')
    expect(results[0].snippet).not.toBeNull()
    expect(results[0].snippet).toContain('「')
    expect(results[0].snippet).toContain('」')
  })

  it('match só em comentário -> match "comment"', () => {
    insertIssue(db, 1, { key: 'BT-3', summary: 'Card qualquer' })
    insertComment(db, 1, 'BT-3', 'Vamos revisar o deploy amanhã de manhã')

    const results = searchGlobal(db, 1, SITE_URL, 'deploy')

    expect(results).toHaveLength(1)
    expect(results[0].key).toBe('BT-3')
    expect(results[0].match).toBe('comment')
  })

  it('dedupe: termo no summary E em comentário da mesma issue -> 1 resultado, match "title"', () => {
    insertIssue(db, 1, { key: 'BT-4', summary: 'Refatorar cache de sessão' })
    insertComment(db, 1, 'BT-4', 'O cache já está funcionando corretamente')

    const results = searchGlobal(db, 1, SITE_URL, 'cache')

    expect(results).toHaveLength(1)
    expect(results[0].key).toBe('BT-4')
    expect(results[0].match).toBe('title')
  })

  it('prefix search: "webho" encontra summary "Refatorar webhooks"', () => {
    insertIssue(db, 1, { key: 'BT-5', summary: 'Refatorar webhooks' })

    const results = searchGlobal(db, 1, SITE_URL, 'webho')

    expect(results.map((r) => r.key)).toContain('BT-5')
    expect(results[0].match).toBe('title')
  })

  it('ordenação: resultados de título vêm antes dos de description/comment', () => {
    insertIssue(db, 1, {
      key: 'BT-6',
      summary: 'Card só com termo na descrição',
      descriptionText: 'algo urgente aconteceu aqui'
    })
    insertIssue(db, 1, { key: 'BT-7', summary: 'Urgente: revisar título' })

    const results = searchGlobal(db, 1, SITE_URL, 'urgente')

    expect(results[0].key).toBe('BT-7')
    expect(results[0].match).toBe('title')
  })

  it('limit é respeitado no total de resultados', () => {
    for (let i = 1; i <= 5; i++) {
      insertIssue(db, 1, { key: `BT-${100 + i}`, summary: `Card recorrente número ${i}` })
    }

    const results = searchGlobal(db, 1, SITE_URL, 'recorrente', 3)

    expect(results).toHaveLength(3)
  })

  it('isolamento: issue de outro workspace_id não aparece', () => {
    insertWorkspace(db, 2, 'https://y.atlassian.net')
    insertIssue(db, 2, { key: 'BT-200', summary: 'termo isolado exclusivo' })

    const results = searchGlobal(db, 1, SITE_URL, 'isolado')

    expect(results).toEqual([])
  })

  it('query só com espaços -> []', () => {
    insertIssue(db, 1, { key: 'BT-8', summary: 'Card qualquer' })

    expect(searchGlobal(db, 1, SITE_URL, '   ')).toEqual([])
  })

  it('busca pela key acha o próprio card mesmo sem a key no texto', () => {
    insertIssue(db, 1, { key: 'BT-806', summary: 'Endpoint público permite trocar telefone' })
    // outro card que CITA a key na descrição não pode ganhar do próprio card
    insertIssue(db, 1, {
      key: 'BT-808',
      summary: 'Card derivado',
      descriptionText: 'Dividido a partir de BT-806'
    })

    const results = searchGlobal(db, 1, SITE_URL, 'BT-806')

    expect(results[0]).toMatchObject({ key: 'BT-806', match: 'title', snippet: null })
    expect(results.map((r) => r.key)).toContain('BT-808')
  })

  it('key em minúsculas e por prefixo também acham o card', () => {
    insertIssue(db, 1, { key: 'BT-806', summary: 'Card de segurança' })

    expect(searchGlobal(db, 1, SITE_URL, 'bt-806')[0]?.key).toBe('BT-806')
    expect(searchGlobal(db, 1, SITE_URL, 'BT-80').map((r) => r.key)).toContain('BT-806')
  })

  it('query só numérica acha a key pela parte numérica', () => {
    insertIssue(db, 1, { key: 'BT-806', summary: 'Card de segurança' })

    expect(searchGlobal(db, 1, SITE_URL, '806').map((r) => r.key)).toContain('BT-806')
  })

  it('key exata vem antes de key mais longa com mesmo prefixo', () => {
    insertIssue(db, 1, { key: 'BT-80', summary: 'Card antigo' })
    insertIssue(db, 1, { key: 'BT-800', summary: 'Card novo' })

    const results = searchGlobal(db, 1, SITE_URL, 'BT-80')

    expect(results[0]?.key).toBe('BT-80')
  })
})
