import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())
vi.mock('../../gh/gh', () => ({ ghAvailable: vi.fn(() => true) }))
vi.mock('../../gh/prs', () => ({ prsForIssue: vi.fn() }))

const { invokeHandler } = await import('../../testing/electronMock')
const { makeTestContext } = await import('../../testing/handlersKit')
const { setPrefs } = await import('../../db/repos/misc')
const { ghAvailable } = await import('../../gh/gh')
const { prsForIssue } = await import('../../gh/prs')
const { registerPrHandlers } = await import('./prs')

let t: ReturnType<typeof makeTestContext>

const PR = {
  repo: 'biudtech/biud-frontend',
  number: 12,
  title: 'fix: algo',
  url: 'https://github.com/biudtech/biud-frontend/pull/12',
  state: 'open' as const,
  isDraft: false,
  reviewDecision: null,
  checks: 'passing' as const,
  updatedAt: '2026-07-20T00:00:00.000Z'
}

beforeEach(() => {
  vi.mocked(ghAvailable).mockReturnValue(true)
  vi.mocked(prsForIssue).mockReset()
  t = makeTestContext()
  registerPrHandlers(t.ctx)
})

describe('prs:status', () => {
  it('reflete a disponibilidade do gh e a pref de integração', async () => {
    setPrefs(t.db, { prIntegration: true })
    const res = await invokeHandler('prs:status', {})
    expect(res.ok && res.data).toEqual({ ghAvailable: true, enabled: true })
  })

  it('gh ausente → ghAvailable false', async () => {
    vi.mocked(ghAvailable).mockReturnValue(false)
    const res = await invokeHandler('prs:status', {})
    expect(res.ok && res.data.ghAvailable).toBe(false)
  })
})

describe('prs:forIssue', () => {
  it('integração ligada e gh disponível → devolve os PRs', async () => {
    setPrefs(t.db, { prIntegration: true, prSearchScope: 'org:biudtech' })
    vi.mocked(prsForIssue).mockResolvedValue([PR])

    const res = await invokeHandler('prs:forIssue', { key: 'BT-1' })
    expect(res.ok && res.data).toEqual({ available: true, prs: [PR] })
    expect(prsForIssue).toHaveBeenCalledWith('BT-1', 'org:biudtech')
  })

  it('integração desligada → available false sem chamar o gh', async () => {
    setPrefs(t.db, { prIntegration: false })
    const res = await invokeHandler('prs:forIssue', { key: 'BT-1' })
    expect(res.ok && res.data).toEqual({ available: false, prs: [] })
    expect(prsForIssue).not.toHaveBeenCalled()
  })

  it('gh indisponível → available false', async () => {
    setPrefs(t.db, { prIntegration: true })
    vi.mocked(ghAvailable).mockReturnValue(false)
    const res = await invokeHandler('prs:forIssue', { key: 'BT-1' })
    expect(res.ok && res.data).toEqual({ available: false, prs: [] })
  })

  it('falha do gh é silenciosa (nunca lança)', async () => {
    setPrefs(t.db, { prIntegration: true })
    vi.mocked(prsForIssue).mockRejectedValue(new Error('gh explodiu'))
    const res = await invokeHandler('prs:forIssue', { key: 'BT-1' })
    expect(res.ok && res.data).toEqual({ available: false, prs: [] })
  })

  it('key vazia → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('prs:forIssue', { key: '  ' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
