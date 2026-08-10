import Database from 'better-sqlite3'
import type { PushChannel, PushEvents } from '@shared/ipc-contract'
import { runMigrations } from '../db/migrations'
import { AppContext } from '../appContext'
import { setIssueGoneResolver } from '../ipc/registry'
import { makeIssueGoneResolver } from '../issues/gone'
import type { JiraClient } from '../jira/client'

/**
 * Kit para testar handlers IPC: DB em memória + AppContext com client Jira
 * falso e push capturado. Requer `vi.mock('electron', …)` com o electronMock
 * NO ARQUIVO DE TESTE (hoisted) antes de importar módulos que tocam electron.
 */

export interface TestContext {
  ctx: AppContext
  db: Database.Database
  workspaceId: number
  pushes: Array<{ channel: PushChannel; payload: unknown }>
  /** troca o client falso em runtime (null = desconectado) */
  setClient(client: Partial<JiraClient> | null): void
}

export function makeTestContext(opts: { client?: Partial<JiraClient> | null } = {}): TestContext {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, display_name, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'me-1', 'Eu Mesmo', 'now')`
  ).run()

  let client: Partial<JiraClient> | null = opts.client ?? null
  const pushes: TestContext['pushes'] = []

  const ctx = new AppContext(db)
  Object.assign(ctx, {
    getClient: () => client as JiraClient | null,
    push: (channel: PushChannel, payload: PushEvents[PushChannel]) =>
      pushes.push({ channel, payload }),
    scheduler: { trigger: async () => true, reschedule: () => {}, stop: () => {} }
  })

  // mesmo tratamento de card excluído da produção (o resolver é global do
  // registry; cada contexto de teste reinstala o seu)
  setIssueGoneResolver(makeIssueGoneResolver(ctx))

  return {
    ctx,
    db,
    workspaceId: 1,
    pushes,
    setClient: (c) => {
      client = c
    }
  }
}

/** Insere uma issue mínima no cache local (colunas essenciais). */
export function seedIssue(
  db: Database.Database,
  key: string,
  extra: Record<string, unknown> = {}
): void {
  const base = {
    workspace_id: 1,
    jira_id: key,
    key,
    summary: `Card ${key}`,
    status: 'To Do',
    status_category: 'new',
    issue_type: 'Task',
    project_key: key.split('-')[0],
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...extra
  }
  const cols = Object.keys(base)
  db.prepare(
    `INSERT INTO issue (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
  ).run(base)
}
