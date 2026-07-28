import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { JiraClient } from './jira/client'
import type { JiraIssue } from './jira/types'
import { runMigrations } from './db/migrations'
import { setPrefs } from './db/repos/misc'
import { shownNotifications, resetElectronMock } from './testing/electronMock'

vi.mock('electron', async () => (await import('./testing/electronMock')).createElectronMock())

const { startWorklogReminder } = await import('./worklogReminder')

const TICK_MS = 60_000
/** Quarta-feira, 17:31 local — dentro da janela do lembrete. */
const WEDNESDAY_1731 = new Date(2026, 6, 1, 17, 31)

let db: Database.Database
let showWindow: () => void

/** Client falso: `pages` é o que o searchAll entrega em cada página. */
function fakeClient(
  pages: JiraIssue[][] = [],
  fail = false
): { client: JiraClient; jqls: string[] } {
  const jqls: string[] = []
  const client = {
    searchAll: vi.fn(
      async (jql: string, _fields: string[], onPage: (page: JiraIssue[]) => void) => {
        jqls.push(jql)
        if (fail) throw new Error('JQL inválido')
        for (const page of pages) onPage(page)
      }
    )
  }
  return { client: client as unknown as JiraClient, jqls }
}

function issues(n: number): JiraIssue[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), key: `BT-${i}` }) as JiraIssue)
}

function insertWorkspace(): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
  ).run()
}

function lastReminder(): string | null {
  const row = db
    .prepare(`SELECT value_json FROM user_pref WHERE key = 'lastWorklogReminderDate'`)
    .get() as { value_json: string } | undefined
  return row?.value_json ?? null
}

/** Avança um tick do interval e deixa as promises internas resolverem. */
async function tick(times = 1): Promise<void> {
  await vi.advanceTimersByTimeAsync(TICK_MS * times)
}

beforeEach(() => {
  resetElectronMock()
  showWindow = vi.fn()
  db = new Database(':memory:')
  runMigrations(db)
  insertWorkspace()
  vi.useFakeTimers()
  vi.setSystemTime(WEDNESDAY_1731)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startWorklogReminder', () => {
  it('sem worklog no dia, notifica e marca a data para não repetir', async () => {
    const { client, jqls } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()

    expect(jqls).toEqual(['worklogAuthor = currentUser() AND worklogDate = "2026-07-01"'])
    expect(shownNotifications).toEqual([
      {
        title: 'Registrar tempo',
        body: 'Nenhum worklog lançado hoje — registre antes de encerrar o dia.'
      }
    ])
    expect(lastReminder()).toBe('2026-07-01')

    // ticks seguintes no mesmo dia não repetem
    await tick(3)
    expect(shownNotifications).toHaveLength(1)

    stop()
  })

  it('com worklog lançado hoje não notifica (e para de paginar na primeira página)', async () => {
    const { client } = fakeClient([issues(1), issues(5)])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()

    expect(shownNotifications).toEqual([])
    expect(lastReminder()).toBe('2026-07-01')

    stop()
  })

  it('falha na consulta não notifica, mas a data fica marcada (sem lembrete duplicado)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = fakeClient([], true)
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()

    expect(shownNotifications).toEqual([])
    expect(lastReminder()).toBe('2026-07-01')
    expect(consoleWarn).toHaveBeenCalledWith(
      '[worklogReminder] falha ao consultar worklogs do dia',
      expect.any(Error)
    )

    stop()
  })

  it('pref desligada nunca consulta nem notifica', async () => {
    setPrefs(db, { worklogReminder: false })
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick(5)

    expect(client.searchAll).not.toHaveBeenCalled()
    expect(shownNotifications).toEqual([])
    expect(lastReminder()).toBeNull()

    stop()
  })

  it('antes do horário configurado não faz nada', async () => {
    setPrefs(db, { worklogReminderTime: '18:00' })
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()
    expect(client.searchAll).not.toHaveBeenCalled()

    // 18:01 do mesmo dia: agora sim
    vi.setSystemTime(new Date(2026, 6, 1, 18, 1))
    await tick()
    expect(client.searchAll).toHaveBeenCalledTimes(1)

    stop()
  })

  it('fim de semana não dispara', async () => {
    vi.setSystemTime(new Date(2026, 6, 4, 18, 0))
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick(5)

    expect(client.searchAll).not.toHaveBeenCalled()
    expect(lastReminder()).toBeNull()

    stop()
  })

  it('desconectado marca a data mas não consulta nem notifica', async () => {
    const stop = startWorklogReminder({ db, getClient: () => null, showWindow })

    await tick()

    expect(shownNotifications).toEqual([])
    expect(lastReminder()).toBe('2026-07-01')

    stop()
  })

  it('sem workspace não segue para a consulta', async () => {
    db.prepare('DELETE FROM workspace').run()
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()

    expect(client.searchAll).not.toHaveBeenCalled()
    expect(lastReminder()).toBe('2026-07-01')

    stop()
  })

  it('cleanup para o interval', async () => {
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    stop()
    await tick(10)

    expect(client.searchAll).not.toHaveBeenCalled()
  })

  it('novo dia útil dispara de novo', async () => {
    const { client } = fakeClient([])
    const stop = startWorklogReminder({ db, getClient: () => client, showWindow })

    await tick()
    expect(shownNotifications).toHaveLength(1)

    // quinta-feira, mesmo horário
    vi.setSystemTime(new Date(2026, 6, 2, 17, 31))
    await tick()

    expect(shownNotifications).toHaveLength(2)
    expect(lastReminder()).toBe('2026-07-02')

    stop()
  })
})
