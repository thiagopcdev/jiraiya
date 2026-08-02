import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { insertActivities } from '../db/repos/activity'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { dismissAlert, listActiveAlerts, setPrefs } from '../db/repos/misc'
import { runAlertEngine } from './engine'

const ME = 'acc-me'

function issue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: 'descrição suficientemente longa para não alertar',
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: ME,
    reporterName: null,
    storyPoints: 3,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
    ...over
  }
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', ?, 'now')`
  ).run(ME)
})

describe('runAlertEngine', () => {
  it('workspace sem cards não gera alerta', () => {
    expect(runAlertEngine(db, 1)).toEqual({ activeCount: 0 })
    expect(listActiveAlerts(db, 1)).toEqual([])
  })

  it('card bloqueador gera alerta crítico com a key na mensagem', () => {
    upsertIssue(db, 1, issue('BT-1', { flagged: true }))

    const { activeCount } = runAlertEngine(db, 1)

    expect(activeCount).toBeGreaterThanOrEqual(1)
    const blocker = listActiveAlerts(db, 1).find((a) => a.ruleId === 'blocker')
    expect(blocker).toMatchObject({ issueKey: 'BT-1', severity: 'critical' })
    expect(blocker?.message).toContain('BT-1')
  })

  it('card concluído não entra no snapshot', () => {
    upsertIssue(
      db,
      1,
      issue('BT-2', {
        flagged: true,
        statusCategory: 'done',
        status: 'Concluído',
        resolvedAt: '2026-07-15T10:00:00.000Z'
      })
    )

    expect(runAlertEngine(db, 1)).toEqual({ activeCount: 0 })
  })

  it('card sem descrição gera alerta de warning', () => {
    upsertIssue(db, 1, issue('BT-3', { descriptionText: null }))

    runAlertEngine(db, 1)

    expect(listActiveAlerts(db, 1).some((a) => a.ruleId === 'sem-descricao')).toBe(true)
  })

  it('alerta some quando a causa é resolvida (reconciliação)', () => {
    upsertIssue(db, 1, issue('BT-4', { flagged: true }))
    runAlertEngine(db, 1)
    expect(listActiveAlerts(db, 1).some((a) => a.ruleId === 'blocker')).toBe(true)

    // as duas rodadas caem no mesmo milissegundo em teste; envelhece o last_seen_at
    // para simular uma rodada posterior (a reconciliação compara com o "agora")
    db.prepare(`UPDATE alert SET last_seen_at = '2026-01-01T00:00:00.000Z'`).run()
    upsertIssue(db, 1, issue('BT-4', { flagged: false }))
    const after = runAlertEngine(db, 1)

    expect(listActiveAlerts(db, 1).some((a) => a.ruleId === 'blocker')).toBe(false)
    expect(after.activeCount).toBe(listActiveAlerts(db, 1).length)
  })

  it('alerta dispensado não conta como ativo', () => {
    upsertIssue(db, 1, issue('BT-5', { flagged: true }))
    runAlertEngine(db, 1)
    const [alert] = listActiveAlerts(db, 1)

    dismissAlert(db, 1, alert.id)
    const { activeCount } = runAlertEngine(db, 1)

    expect(activeCount).toBe(listActiveAlerts(db, 1).length)
    expect(listActiveAlerts(db, 1).some((a) => a.id === alert.id)).toBe(false)
  })

  it('usa stalledDays dos prefs e a última atividade do card', () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString()
    upsertIssue(db, 1, issue('BT-6', { updatedAt: old }))
    insertActivities(db, 1, [
      {
        issueKey: 'BT-6',
        kind: 'comment',
        actorAccountId: ME,
        actorName: 'Eu',
        field: null,
        fromValue: null,
        toValue: null,
        bodyText: 'mexi hoje',
        occurredAt: new Date().toISOString(),
        sourceId: 'c1'
      }
    ])
    setPrefs(db, { stalledDays: 1 })

    runAlertEngine(db, 1)

    // atividade de hoje impede o alerta de "parado"
    expect(listActiveAlerts(db, 1).some((a) => a.ruleId.includes('parad'))).toBe(false)
  })

  it('alertas são isolados por workspace', () => {
    db.prepare(
      `INSERT INTO workspace (id, site_url, email, account_id, created_at)
       VALUES (2, 'https://y.atlassian.net', 'o@y.com', 'acc-outro', 'now')`
    ).run()
    upsertIssue(db, 1, issue('BT-7', { flagged: true }))

    runAlertEngine(db, 1)
    runAlertEngine(db, 2)

    expect(listActiveAlerts(db, 1).length).toBeGreaterThan(0)
    expect(listActiveAlerts(db, 2)).toEqual([])
  })
})
