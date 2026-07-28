import { beforeEach, describe, expect, it, vi } from 'vitest'

const runGhMock = vi.hoisted(() => vi.fn())
vi.mock('./gh', () => ({ runGh: runGhMock }))

const { prsForIssue } = await import('./prs')

function searchItem(number: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    title: `feat: algo ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-07-20T10:00:00Z',
    repository: { nameWithOwner: 'o/r' },
    ...over
  }
}

/**
 * Responde ao `gh search prs` com a lista dada e a cada `gh pr view` com o
 * detalhe correspondente ao número do PR.
 */
function ghAnswers(
  search: unknown,
  details: Record<string, unknown | Error> = {}
): { calls: string[][] } {
  const calls: string[][] = []
  runGhMock.mockImplementation(async (args: string[]) => {
    calls.push(args)
    if (args[0] === 'search') {
      return typeof search === 'string' ? search : JSON.stringify(search)
    }
    const detail = details[args[2]]
    if (detail instanceof Error) throw detail
    return typeof detail === 'string' ? detail : JSON.stringify(detail ?? {})
  })
  return { calls }
}

beforeEach(() => {
  runGhMock.mockReset()
})

describe('prsForIssue', () => {
  it('busca por key + escopo e devolve os PRs enriquecidos', async () => {
    const { calls } = ghAnswers([searchItem(12)], {
      '12': {
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }]
      }
    })

    const prs = await prsForIssue('BT-100', 'org:biudtech  repo:o/r')

    expect(prs).toEqual([
      {
        repo: 'o/r',
        number: 12,
        title: 'feat: algo 12',
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        isDraft: false,
        updatedAt: '2026-07-20T10:00:00Z',
        reviewDecision: 'APPROVED',
        checks: 'passing'
      }
    ])
    expect(calls[0]).toEqual([
      'search',
      'prs',
      'BT-100',
      'org:biudtech',
      'repo:o/r',
      '--json',
      'number,title,state,isDraft,url,repository,updatedAt',
      '--limit',
      '10',
      '--sort',
      'updated'
    ])
    expect(calls[1]).toEqual([
      'pr',
      'view',
      '12',
      '--repo',
      'o/r',
      '--json',
      'state,reviewDecision,statusCheckRollup,mergedAt'
    ])
  })

  it('escopo vazio não gera token em branco na busca', async () => {
    const { calls } = ghAnswers([])

    await prsForIssue('BT-101', '   ')

    expect(calls[0].slice(0, 4)).toEqual(['search', 'prs', 'BT-101', '--json'])
  })

  it("state MERGED vira 'merged'", async () => {
    ghAnswers([searchItem(13)], { '13': { state: 'MERGED', reviewDecision: null } })

    const [pr] = await prsForIssue('BT-102', '')
    expect(pr.state).toBe('merged')
    expect(pr.reviewDecision).toBeNull()
  })

  it('mergedAt preenchido também vira merged mesmo com state closed', async () => {
    ghAnswers([searchItem(14, { state: 'CLOSED' })], {
      '14': { state: 'CLOSED', mergedAt: '2026-07-21T09:00:00Z' }
    })

    const [pr] = await prsForIssue('BT-103', '')
    expect(pr.state).toBe('merged')
  })

  it('closed sem merge continua closed', async () => {
    ghAnswers([searchItem(15, { state: 'CLOSED' })], { '15': { state: 'CLOSED', mergedAt: null } })

    const [pr] = await prsForIssue('BT-104', '')
    expect(pr.state).toBe('closed')
  })

  it('checks falhando e review pedindo mudanças aparecem no resumo', async () => {
    ghAnswers([searchItem(16)], {
      '16': {
        state: 'OPEN',
        reviewDecision: 'CHANGES_REQUESTED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }]
      }
    })

    const [pr] = await prsForIssue('BT-105', '')
    expect(pr).toMatchObject({ reviewDecision: 'CHANGES_REQUESTED', checks: 'failing' })
  })

  it('reviewDecision vazio vira null', async () => {
    ghAnswers([searchItem(17)], { '17': { state: 'OPEN', reviewDecision: '' } })

    const [pr] = await prsForIssue('BT-106', '')
    expect(pr.reviewDecision).toBeNull()
    expect(pr.checks).toBeNull()
  })

  it('JSON inválido na busca devolve lista vazia e nem tenta enriquecer', async () => {
    const { calls } = ghAnswers('isso não é json')

    await expect(prsForIssue('BT-107', '')).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('falha no gh pr view mantém o PR base sem review/checks', async () => {
    ghAnswers([searchItem(18)], { '18': new Error('gh falhou: sem permissão') })

    const [pr] = await prsForIssue('BT-108', '')
    expect(pr).toMatchObject({ number: 18, state: 'open', reviewDecision: null, checks: null })
  })

  it('JSON inválido no detalhe mantém o PR base', async () => {
    ghAnswers([searchItem(19)], { '19': 'lixo' })

    const [pr] = await prsForIssue('BT-109', '')
    expect(pr).toMatchObject({ reviewDecision: null, checks: null })
  })

  it('enriquece no máximo os 5 primeiros', async () => {
    const items = Array.from({ length: 8 }, (_, i) => searchItem(i + 1))
    const { calls } = ghAnswers(items, {})

    const prs = await prsForIssue('BT-110', '')

    expect(prs).toHaveLength(8)
    expect(calls.filter((c) => c[0] === 'pr')).toHaveLength(5)
  })

  it('segunda chamada no mesmo card usa o cache (sem novo gh)', async () => {
    ghAnswers([searchItem(20)], { '20': { state: 'OPEN' } })

    const first = await prsForIssue('BT-111', '')
    runGhMock.mockClear()
    const second = await prsForIssue('BT-111', '')

    expect(runGhMock).not.toHaveBeenCalled()
    expect(second).toBe(first)
  })

  it('cards diferentes têm caches independentes', async () => {
    ghAnswers([searchItem(21)], { '21': { state: 'OPEN' } })
    await prsForIssue('BT-112', '')
    runGhMock.mockClear()

    ghAnswers([searchItem(22)], { '22': { state: 'OPEN' } })
    const prs = await prsForIssue('BT-113', '')

    expect(prs[0].number).toBe(22)
    expect(runGhMock).toHaveBeenCalled()
  })

  it('cache expira depois de 5 minutos', async () => {
    ghAnswers([searchItem(23)], { '23': { state: 'OPEN' } })
    await prsForIssue('BT-114', '')

    const realNow = Date.now
    Date.now = () => realNow() + 6 * 60_000
    try {
      runGhMock.mockClear()
      ghAnswers([searchItem(24)], { '24': { state: 'MERGED' } })
      const prs = await prsForIssue('BT-114', '')
      expect(prs[0].number).toBe(24)
    } finally {
      Date.now = realNow
    }
  })

  it('erro no gh search propaga (a UI decide o que mostrar)', async () => {
    runGhMock.mockRejectedValue(new Error('CLI do gh não encontrado'))

    await expect(prsForIssue('BT-115', '')).rejects.toThrow('CLI do gh não encontrado')
  })
})
