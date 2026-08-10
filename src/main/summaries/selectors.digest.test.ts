import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/migrations'
import { insertActivities } from '../db/repos/activity'
import { upsertSprints } from '../db/repos/catalog'
import { upsertIssue, type IssueUpsert } from '../db/repos/issue'
import { buildPeriodDigest } from './selectors'

const ME = 'acc-me'
const SITE = 'https://x.atlassian.net'
const iso = (d: string): string => new Date(d).toISOString()

const WS = { id: 1, account_id: ME, site_url: SITE }
const RANGE = {
  start: iso('2026-07-10T00:00:00Z'),
  end: iso('2026-07-18T00:00:00Z'),
  label: 'semana de 10 a 17/07'
}

function baseIssue(key: string, over: Partial<IssueUpsert> = {}): IssueUpsert {
  return {
    jiraId: key,
    key,
    projectKey: 'BT',
    summary: `Issue ${key}`,
    descriptionText: null,
    issueType: 'Task',
    status: 'Em andamento',
    statusCategory: 'indeterminate',
    priority: null,
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: null,
    reporterName: null,
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: iso('2026-07-01T09:00:00Z'),
    updatedAt: iso('2026-07-16T10:00:00Z'),
    resolvedAt: null,
    ...over
  }
}

type Activity = Parameters<typeof insertActivities>[2][number]

function activity(over: Partial<Activity> & { issueKey: string; sourceId: string }): Activity {
  return {
    kind: 'comment',
    actorAccountId: ME,
    actorName: 'Eu',
    field: null,
    fromValue: null,
    toValue: null,
    bodyText: null,
    occurredAt: iso('2026-07-15T10:00:00Z'),
    ...over
  } as Activity
}

let db: Database.Database

function digest(stalledDays = 3): ReturnType<typeof buildPeriodDigest> {
  return buildPeriodDigest(db, WS, RANGE, stalledDays)
}

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, ?, 'e@x.com', ?, 'now')`
  ).run(SITE, ME)
})

describe('buildPeriodDigest — período vazio', () => {
  it('devolve o rótulo e todas as listas vazias', () => {
    expect(digest()).toEqual({
      periodLabel: 'semana de 10 a 17/07',
      concluidos: [],
      avancaram: [],
      comentados: [],
      criados: [],
      emAndamento: [],
      paraHoje: [],
      aguardando: [],
      bloqueados: [],
      paradosHaDias: [],
      sprintAtual: null
    })
  })
})

describe('buildPeriodDigest — concluídos e avançaram', () => {
  it('resolvidos no período entram em concluidos com a URL do card', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        statusCategory: 'done',
        status: 'Concluído',
        resolvedAt: iso('2026-07-15T10:00:00Z')
      })
    )

    const out = digest()

    expect(out.concluidos).toEqual([
      { key: 'BT-1', summary: 'Issue BT-1', url: `${SITE}/browse/BT-1` }
    ])
  })

  it('card concluído não aparece também em avancaram nem em comentados', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-1', {
        statusCategory: 'done',
        status: 'Concluído',
        resolvedAt: iso('2026-07-15T12:00:00Z')
      })
    )
    insertActivities(db, 1, [
      activity({
        issueKey: 'BT-1',
        sourceId: 's1',
        kind: 'status_change',
        field: 'status',
        fromValue: 'Em andamento',
        toValue: 'Concluído'
      }),
      activity({ issueKey: 'BT-1', sourceId: 'c1', bodyText: 'fechei' })
    ])

    const out = digest()

    expect(out.concluidos.map((i) => i.key)).toEqual(['BT-1'])
    expect(out.avancaram).toEqual([])
    expect(out.comentados).toEqual([])
  })

  it('avancaram traz o detalhe com a última transição do período', () => {
    upsertIssue(db, 1, baseIssue('BT-2'))
    insertActivities(db, 1, [
      activity({
        issueKey: 'BT-2',
        sourceId: 's1',
        kind: 'status_change',
        field: 'status',
        fromValue: 'A fazer',
        toValue: 'Em andamento',
        occurredAt: iso('2026-07-11T10:00:00Z')
      }),
      activity({
        issueKey: 'BT-2',
        sourceId: 's2',
        kind: 'status_change',
        field: 'status',
        fromValue: 'Em andamento',
        toValue: 'Em revisão',
        occurredAt: iso('2026-07-14T10:00:00Z')
      })
    ])

    expect(digest().avancaram).toEqual([
      {
        key: 'BT-2',
        summary: 'Issue BT-2',
        url: `${SITE}/browse/BT-2`,
        detail: 'Em andamento → Em revisão'
      }
    ])
  })

  it("transição sem fromValue mostra '?' como origem", () => {
    upsertIssue(db, 1, baseIssue('BT-2'))
    insertActivities(db, 1, [
      activity({
        issueKey: 'BT-2',
        sourceId: 's1',
        kind: 'status_change',
        field: 'status',
        fromValue: null,
        toValue: 'Em andamento'
      })
    ])

    expect(digest().avancaram[0].detail).toBe('? → Em andamento')
  })

  it('comentados lista os cards em que comentei', () => {
    upsertIssue(db, 1, baseIssue('BT-3', { statusCategory: 'new', status: 'A fazer' }))
    insertActivities(db, 1, [
      activity({ issueKey: 'BT-3', sourceId: 'c1', bodyText: 'comentei aqui' })
    ])

    expect(digest().comentados.map((i) => i.key)).toEqual(['BT-3'])
  })
})

describe('buildPeriodDigest — criados', () => {
  it('cards criados por mim no período entram com o summary da activity', () => {
    upsertIssue(db, 1, baseIssue('BT-4'))
    insertActivities(db, 1, [activity({ issueKey: 'BT-4', sourceId: 'cr1', kind: 'created' })])

    expect(digest().criados).toEqual([
      { key: 'BT-4', summary: 'Issue BT-4', url: `${SITE}/browse/BT-4` }
    ])
  })

  it('criação por terceiros não entra', () => {
    upsertIssue(db, 1, baseIssue('BT-5'))
    insertActivities(db, 1, [
      activity({
        issueKey: 'BT-5',
        sourceId: 'cr2',
        kind: 'created',
        actorAccountId: 'acc-outro',
        actorName: 'Outro'
      })
    ])

    expect(digest().criados).toEqual([])
  })
})

describe('buildPeriodDigest — paraHoje x aguardando', () => {
  it('separa acionáveis por mim de cards em estado de espera pelo nome do status', () => {
    upsertIssue(db, 1, baseIssue('BT-10', { status: 'A fazer', statusCategory: 'new' }))
    upsertIssue(db, 1, baseIssue('BT-11', { status: 'Em andamento' }))
    upsertIssue(db, 1, baseIssue('BT-12', { status: 'Em homologação' }))
    upsertIssue(db, 1, baseIssue('BT-13', { status: 'Code review' }))
    upsertIssue(db, 1, baseIssue('BT-14', { status: 'Aguardando deploy' }))

    const out = digest()

    expect(out.paraHoje.map((i) => i.key).sort()).toEqual(['BT-10', 'BT-11'])
    expect(out.aguardando.map((i) => i.key).sort()).toEqual(['BT-12', 'BT-13', 'BT-14'])
    expect(out.paraHoje.find((i) => i.key === 'BT-10')?.detail).toBe('A fazer')
  })

  it('cards concluídos e de terceiros ficam fora de paraHoje/aguardando/emAndamento', () => {
    upsertIssue(
      db,
      1,
      baseIssue('BT-20', {
        statusCategory: 'done',
        status: 'Concluído',
        resolvedAt: iso('2026-07-15T10:00:00Z')
      })
    )
    upsertIssue(
      db,
      1,
      baseIssue('BT-21', { assigneeAccountId: 'acc-outro', assigneeName: 'Outro' })
    )

    const out = digest()

    expect(out.paraHoje).toEqual([])
    expect(out.aguardando).toEqual([])
    expect(out.emAndamento).toEqual([])
  })

  it('emAndamento traz o status como detalhe', () => {
    upsertIssue(db, 1, baseIssue('BT-22', { status: 'Em andamento' }))

    expect(digest().emAndamento).toEqual([
      {
        key: 'BT-22',
        summary: 'Issue BT-22',
        url: `${SITE}/browse/BT-22`,
        detail: 'Em andamento'
      }
    ])
  })
})

describe('buildPeriodDigest — bloqueados', () => {
  it('flagged e prioridade máxima entram, sem duplicar entre inProgress e stalled', () => {
    upsertIssue(db, 1, baseIssue('BT-30', { flagged: true }))
    upsertIssue(db, 1, baseIssue('BT-31', { priority: 'Highest' }))
    upsertIssue(db, 1, baseIssue('BT-32', { priority: 'Blocker' }))
    upsertIssue(db, 1, baseIssue('BT-33', { priority: 'Medium' }))
    // BT-30 também está parado (sem activity e updated_at antigo) → apareceria 2x
    db.prepare(`UPDATE issue SET updated_at = '2020-01-01T00:00:00.000Z' WHERE key = 'BT-30'`).run()

    const out = digest()

    expect(out.bloqueados.map((i) => i.key).sort()).toEqual(['BT-30', 'BT-31', 'BT-32'])
    expect(out.bloqueados.filter((i) => i.key === 'BT-30')).toHaveLength(1)
    expect(out.bloqueados.find((i) => i.key === 'BT-31')?.detail).toBe('Highest')
    expect(out.bloqueados.find((i) => i.key === 'BT-30')?.detail).toBeUndefined()
  })
})

describe('buildPeriodDigest — paradosHaDias', () => {
  it('conta os dias desde a última atividade minha', () => {
    upsertIssue(db, 1, baseIssue('BT-40'))
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    db.prepare('UPDATE issue SET updated_at = ? WHERE key = ?').run(tenDaysAgo, 'BT-40')

    const [parado] = digest(3).paradosHaDias

    expect(parado.key).toBe('BT-40')
    expect(parado.dias).toBe(10)
  })

  it('sem updated_at nem atividade, cai no stalledDays informado', () => {
    upsertIssue(db, 1, baseIssue('BT-41', { updatedAt: null }))

    expect(digest(5).paradosHaDias).toEqual([
      { key: 'BT-41', summary: 'Issue BT-41', url: `${SITE}/browse/BT-41`, dias: 5 }
    ])
  })

  it('card com atividade recente não é considerado parado', () => {
    upsertIssue(db, 1, baseIssue('BT-42'))
    insertActivities(db, 1, [
      activity({
        issueKey: 'BT-42',
        sourceId: 'a1',
        bodyText: 'toquei hoje',
        occurredAt: new Date().toISOString()
      })
    ])

    expect(digest(3).paradosHaDias).toEqual([])
  })
})

describe('buildPeriodDigest — sprint atual', () => {
  it('traz nome, fim e a contagem de cards abertos da sprint ativa', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 77,
        boardJiraId: 5,
        name: 'Sprint 12',
        state: 'active',
        startDate: iso('2026-07-08T00:00:00Z'),
        endDate: iso('2026-07-22T00:00:00Z'),
        completeDate: null
      }
    ])
    upsertIssue(db, 1, baseIssue('BT-50', { sprintJiraId: 77 }))
    upsertIssue(
      db,
      1,
      baseIssue('BT-51', { sprintJiraId: 77, statusCategory: 'done', status: 'Concluído' })
    )
    upsertIssue(db, 1, baseIssue('BT-52', { sprintJiraId: 77, statusCategory: null }))
    upsertIssue(db, 1, baseIssue('BT-53', { sprintJiraId: 78 }))

    expect(digest().sprintAtual).toEqual({
      nome: 'Sprint 12',
      fim: iso('2026-07-22T00:00:00Z'),
      abertas: 2
    })
  })

  it('sprint ativa sem nome usa o rótulo padrão', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 78,
        boardJiraId: 5,
        name: null,
        state: 'active',
        startDate: iso('2026-07-08T00:00:00Z'),
        endDate: null,
        completeDate: null
      }
    ])

    expect(digest().sprintAtual).toEqual({ nome: 'Sprint', fim: null, abertas: 0 })
  })

  it('só sprint fechada → sem sprint atual', () => {
    upsertSprints(db, 1, [
      {
        jiraId: 79,
        boardJiraId: 5,
        name: 'Sprint 11',
        state: 'closed',
        startDate: iso('2026-06-24T00:00:00Z'),
        endDate: iso('2026-07-07T00:00:00Z'),
        completeDate: iso('2026-07-07T10:00:00Z')
      }
    ])

    expect(digest().sprintAtual).toBeNull()
  })
})
