import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrations'
import { listSummaries, setPrefs } from './db/repos/misc'
import { upsertIssue, type IssueUpsert } from './db/repos/issue'
import { shownNotifications, resetElectronMock } from './testing/electronMock'

vi.mock('electron', async () => (await import('./testing/electronMock')).createElectronMock())

const activeProviderMock = vi.hoisted(() => vi.fn())
vi.mock('./ai/service', () => ({ activeProvider: activeProviderMock }))

const enhanceSummaryMock = vi.hoisted(() => vi.fn())
vi.mock('./ai/prompts', () => ({ enhanceSummary: enhanceSummaryMock }))

const { runMorningBriefing } = await import('./briefing')

const ME = 'acc-me'

let db: Database.Database
let pushed: Array<{ summaryId: number }>
let showWindow: () => void

function deps(aiAvailable = false): Parameters<typeof runMorningBriefing>[2] {
  return { aiAvailable: () => aiAvailable, showWindow }
}

const ctx = {
  push: (s: { summaryId: number }) => pushed.push(s)
}

function yesterdayIssue(): IssueUpsert {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
  yesterday.setHours(10, 0, 0, 0)
  return {
    jiraId: '1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Card entregue ontem',
    descriptionText: null,
    issueType: 'Task',
    status: 'Concluído',
    statusCategory: 'done',
    priority: null,
    assigneeAccountId: ME,
    assigneeName: 'Eu',
    reporterAccountId: null,
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: yesterday.toISOString(),
    updatedAt: yesterday.toISOString(),
    resolvedAt: yesterday.toISOString()
  }
}

function pref(key: string): string | null {
  const row = db.prepare('SELECT value_json FROM user_pref WHERE key = ?').get(key) as
    { value_json: string } | undefined
  return row?.value_json ?? null
}

const today = new Date().toLocaleDateString('sv')

beforeEach(() => {
  resetElectronMock()
  activeProviderMock.mockReset()
  enhanceSummaryMock.mockReset()
  pushed = []
  showWindow = vi.fn()
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', ?, 'now')`
  ).run(ME)
})

describe('runMorningBriefing — guardas', () => {
  it('pref desligada não gera nada', async () => {
    setPrefs(db, { morningBriefing: false })

    await runMorningBriefing(db, ctx, deps())

    expect(listSummaries(db, 1)).toEqual([])
    expect(pushed).toEqual([])
    expect(shownNotifications).toEqual([])
  })

  it('já rodou hoje: não gera de novo', async () => {
    db.prepare(`INSERT INTO user_pref (key, value_json) VALUES ('lastBriefingDate', ?)`).run(today)

    await runMorningBriefing(db, ctx, deps())

    expect(listSummaries(db, 1)).toEqual([])
  })

  it('sem workspace conectado não gera nem marca a data', async () => {
    db.prepare('DELETE FROM workspace').run()

    await runMorningBriefing(db, ctx, deps())

    expect(pref('lastBriefingDate')).toBeNull()
    expect(pushed).toEqual([])
  })
})

describe('runMorningBriefing — geração', () => {
  it('sem IA salva a daily pelo template, marca a data, faz push e notifica', async () => {
    upsertIssue(db, 1, yesterdayIssue())

    await runMorningBriefing(db, ctx, deps(false))

    const [summary] = listSummaries(db, 1)
    expect(summary).toMatchObject({
      periodType: 'yesterday',
      template: 'standup',
      generatedBy: 'template'
    })
    expect(summary.contentMd).toContain('BT-1')
    expect(pref('lastBriefingDate')).toBe(today)
    expect(pref('lastBriefingSummaryId')).toBe(String(summary.id))
    expect(pushed).toEqual([{ summaryId: summary.id }])
    expect(shownNotifications).toEqual([{ title: 'Jiraiya', body: 'Sua daily está pronta' }])
    expect(activeProviderMock).not.toHaveBeenCalled()
  })

  it('com IA disponível usa o texto da IA e registra o provider', async () => {
    upsertIssue(db, 1, yesterdayIssue())
    activeProviderMock.mockReturnValue({ id: 'claude' })
    enhanceSummaryMock.mockResolvedValue('# Daily escrita pela IA')

    await runMorningBriefing(db, ctx, deps(true))

    const [summary] = listSummaries(db, 1)
    expect(summary.contentMd).toBe('# Daily escrita pela IA')
    expect(summary.generatedBy).toBe('claude')

    const input = enhanceSummaryMock.mock.calls[0][0] as {
      templateMarkdown: string
      digestJson: string
    }
    expect(input.templateMarkdown).toContain('BT-1')
    expect(JSON.parse(input.digestJson)).toHaveProperty('comentariosDoPeriodo')
  })

  it('falha da IA cai no template sem quebrar', async () => {
    upsertIssue(db, 1, yesterdayIssue())
    activeProviderMock.mockReturnValue({ id: 'gemini' })
    enhanceSummaryMock.mockRejectedValue(new Error('IA fora do ar'))

    await runMorningBriefing(db, ctx, deps(true))

    const [summary] = listSummaries(db, 1)
    expect(summary.generatedBy).toBe('template')
    expect(summary.contentMd).toContain('BT-1')
    expect(pushed).toHaveLength(1)
  })

  it('aiAvailable true mas nenhum provider ativo → template', async () => {
    activeProviderMock.mockReturnValue(null)

    await runMorningBriefing(db, ctx, deps(true))

    expect(listSummaries(db, 1)[0].generatedBy).toBe('template')
    expect(enhanceSummaryMock).not.toHaveBeenCalled()
  })

  it('período sem registros ainda gera a daily (com o texto de vazio)', async () => {
    await runMorningBriefing(db, ctx, deps(false))

    const [summary] = listSummaries(db, 1)
    expect(summary.contentMd).toContain('Sem registros no período')
    expect(shownNotifications).toHaveLength(1)
  })

  it('a segunda execução no mesmo dia é ignorada', async () => {
    await runMorningBriefing(db, ctx, deps(false))
    await runMorningBriefing(db, ctx, deps(false))

    expect(listSummaries(db, 1)).toHaveLength(1)
    expect(pushed).toHaveLength(1)
  })
})

/** Promise que o teste resolve quando quiser (simula a IA lenta). */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('runMorningBriefing — concorrência', () => {
  it('dois disparos dentro da janela do await da IA geram uma única daily', async () => {
    upsertIssue(db, 1, yesterdayIssue())
    activeProviderMock.mockReturnValue({ id: 'claude' })
    const ia = deferred<string>()
    enhanceSummaryMock.mockReturnValue(ia.promise)

    // fire-and-forget, como os dois disparos reais (fim do sync e timer do boot)
    const primeiro = runMorningBriefing(db, ctx, deps(true))
    const segundo = runMorningBriefing(db, ctx, deps(true))

    ia.resolve('# Daily escrita pela IA')
    await Promise.all([primeiro, segundo])

    const summaries = listSummaries(db, 1)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].contentMd).toBe('# Daily escrita pela IA')
    expect(enhanceSummaryMock).toHaveBeenCalledTimes(1)
    expect(pref('lastBriefingDate')).toBe(today)
    expect(pref('lastBriefingSummaryId')).toBe(String(summaries[0].id))
    expect(pushed).toHaveLength(1)
    expect(shownNotifications).toHaveLength(1)
  })

  it('exceção na geração libera o guard para a execução seguinte', async () => {
    upsertIssue(db, 1, yesterdayIssue())
    const explode = {
      aiAvailable: () => {
        throw new Error('provider quebrado')
      },
      showWindow
    }

    await expect(runMorningBriefing(db, ctx, explode)).rejects.toThrow('provider quebrado')

    await runMorningBriefing(db, ctx, deps(false))

    expect(listSummaries(db, 1)).toHaveLength(1)
    expect(pref('lastBriefingDate')).toBe(today)
  })
})
