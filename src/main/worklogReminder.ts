import { Notification } from 'electron'
import type Database from 'better-sqlite3'
import type { JiraClient } from './jira/client'
import type { JiraIssue } from './jira/types'
import { getPrefs } from './db/repos/misc'
import { getWorkspaceRow } from './db/repos/workspace'

const TICK_MS = 60_000
const PREF_KEY = 'lastWorklogReminderDate'

/** Data local YYYY-MM-DD (mesmo padrão de src/main/briefing.ts). */
function localDate(d: Date): string {
  return d.toLocaleDateString('sv')
}

/** Sinaliza que a primeira página já basta e o loop de páginas deve parar. */
class StopPaging extends Error {}

/**
 * true quando: dia útil (seg-sex), horário local de `now` já passou de
 * `reminderTime` (HH:MM) e o lembrete ainda não foi disparado hoje.
 */
export function shouldRemind(
  now: Date,
  reminderTime: string,
  lastReminderDate: string | null
): boolean {
  const weekday = now.getDay()
  if (weekday === 0 || weekday === 6) return false

  const [rawHour, rawMinute] = reminderTime.split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  if (nowMinutes < hour * 60 + minute) return false

  return lastReminderDate !== localDate(now)
}

function getPref(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value_json FROM user_pref WHERE key = ?`).get(key) as
    { value_json: string } | undefined
  return row?.value_json ?? null
}

function setPref(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_pref (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(key, value)
}

/** Consulta se existe algum worklog do usuário na data local informada. */
async function hasWorklogToday(client: JiraClient, date: string): Promise<boolean | null> {
  const jql = `worklogAuthor = currentUser() AND worklogDate = "${date}"`
  let found = 0
  try {
    await client.searchAll(jql, [], (page: JiraIssue[]) => {
      found += page.length
      // basta saber se existe ao menos uma issue — não pagina o resto
      throw new StopPaging()
    })
  } catch (err) {
    if (!(err instanceof StopPaging)) {
      console.warn('[worklogReminder] falha ao consultar worklogs do dia', err)
      return null
    }
  }
  return found > 0
}

/**
 * Lembrete de fim de dia: em dia útil, passado o horário configurado, avisa se
 * nenhum worklog foi lançado hoje. Idempotente pela data local (user_pref
 * 'lastWorklogReminderDate' é gravada ANTES da consulta, então uma falha do JQL
 * não gera lembrete duplicado no mesmo dia).
 * Retorna a função de cleanup do interval.
 */
export function startWorklogReminder(deps: {
  db: Database.Database
  getClient: () => JiraClient | null
  showWindow: () => void
}): () => void {
  const timer = setInterval(() => {
    void tick()
  }, TICK_MS)

  async function tick(): Promise<void> {
    const prefs = getPrefs(deps.db)
    if (!prefs.worklogReminder) return

    const now = new Date()
    if (!shouldRemind(now, prefs.worklogReminderTime, getPref(deps.db, PREF_KEY))) return

    const today = localDate(now)
    // grava primeiro: mesmo que a consulta falhe, não repete o lembrete hoje
    setPref(deps.db, PREF_KEY, today)

    const workspace = getWorkspaceRow(deps.db)
    if (!workspace) return
    const client = deps.getClient()
    if (!client) return

    const hasWorklog = await hasWorklogToday(client, today)
    if (hasWorklog !== false) return

    if (!Notification.isSupported()) return
    const n = new Notification({
      title: 'Registrar tempo',
      body: 'Nenhum worklog lançado hoje — registre antes de encerrar o dia.'
    })
    n.on('click', () => deps.showWindow())
    n.show()
  }

  return () => clearInterval(timer)
}
