import { runGh } from './gh'

/** PR do GitHub associado a um card, com estado, review e checks. */
export interface PrInfo {
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  checks: 'passing' | 'failing' | 'pending' | null
  updatedAt: string
}

/** Item base vindo do `gh search prs` (sem detalhes de review/checks). */
type SearchItem = {
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  isDraft: boolean
  updatedAt: string
}

/**
 * Normaliza a saída de `gh search prs --json number,title,state,isDraft,url,repository,updatedAt`.
 * Itens sem number/url/repository.nameWithOwner são descartados; entrada não-array → [].
 * state em minúsculas; valores fora de open/closed → 'open'.
 */
export function mapSearchResults(json: unknown): SearchItem[] {
  if (!Array.isArray(json)) return []
  const out: SearchItem[] = []
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const number = item.number
    const url = item.url
    const repository = item.repository as Record<string, unknown> | undefined
    const repo =
      repository && typeof repository.nameWithOwner === 'string' ? repository.nameWithOwner : null
    if (typeof number !== 'number' || typeof url !== 'string' || !url || !repo) continue

    const rawState = typeof item.state === 'string' ? item.state.toLowerCase() : ''
    const state: 'open' | 'closed' = rawState === 'closed' ? 'closed' : 'open'
    out.push({
      repo,
      number,
      title: typeof item.title === 'string' ? item.title : '',
      url,
      state,
      isDraft: item.isDraft === true,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
    })
  }
  return out
}

const FAIL_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED'])
const PENDING_STATES = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED'])

/**
 * Resume o statusCheckRollup do gh (array de contexts com conclusion/status/state).
 * Qualquer FAILURE/ERROR/CANCELLED → 'failing'; senão qualquer pendente (ou conclusion
 * vazia com status != COMPLETED) → 'pending'; senão 'passing'. Vazio/null/não-array → null.
 */
export function summarizeChecks(rollup: unknown): 'passing' | 'failing' | 'pending' | null {
  if (!Array.isArray(rollup) || rollup.length === 0) return null
  let sawPending = false
  for (const raw of rollup) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    const conclusion = typeof c.conclusion === 'string' ? c.conclusion.toUpperCase() : ''
    const status = typeof c.status === 'string' ? c.status.toUpperCase() : ''
    const state = typeof c.state === 'string' ? c.state.toUpperCase() : ''
    if (FAIL_STATES.has(conclusion) || FAIL_STATES.has(state)) return 'failing'
    if (
      PENDING_STATES.has(conclusion) ||
      PENDING_STATES.has(status) ||
      PENDING_STATES.has(state) ||
      (conclusion === '' && status !== '' && status !== 'COMPLETED')
    ) {
      sawPending = true
    }
  }
  return sawPending ? 'pending' : 'passing'
}

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; prs: PrInfo[] }>()

/**
 * Busca PRs relacionados a um card via `gh search prs` e enriquece os 5 primeiros
 * com estado (merged), review e checks. Cache em memória por 5 min por issueKey.
 */
export async function prsForIssue(issueKey: string, scope: string): Promise<PrInfo[]> {
  const cached = cache.get(issueKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.prs

  const scopeTokens = scope
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const raw = await runGh([
    'search',
    'prs',
    issueKey,
    ...scopeTokens,
    '--json',
    'number,title,state,isDraft,url,repository,updatedAt',
    '--limit',
    '10',
    '--sort',
    'updated'
  ])

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  const prs: PrInfo[] = mapSearchResults(parsed).map((b) => ({
    ...b,
    reviewDecision: null,
    checks: null
  }))

  const enrich = await Promise.allSettled(
    prs
      .slice(0, 5)
      .map((pr) =>
        runGh([
          'pr',
          'view',
          String(pr.number),
          '--repo',
          pr.repo,
          '--json',
          'state,reviewDecision,statusCheckRollup,mergedAt'
        ])
      )
  )

  enrich.forEach((res, i) => {
    if (res.status !== 'fulfilled') return
    try {
      const d = JSON.parse(res.value) as Record<string, unknown>
      const pr = prs[i]
      const state = typeof d.state === 'string' ? d.state.toUpperCase() : ''
      if (state === 'MERGED' || (typeof d.mergedAt === 'string' && d.mergedAt)) {
        pr.state = 'merged'
      }
      const rd = typeof d.reviewDecision === 'string' && d.reviewDecision ? d.reviewDecision : null
      pr.reviewDecision = rd as PrInfo['reviewDecision']
      pr.checks = summarizeChecks(d.statusCheckRollup)
    } catch {
      // mantém a base sem review/checks
    }
  })

  cache.set(issueKey, { at: Date.now(), prs })
  return prs
}
