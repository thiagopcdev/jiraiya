/**
 * Parser puro das "ações rápidas" do ⌘K (ex.: "mover BT-123 em andamento",
 * "atribuir BT-123 mim", "apontar 1h30m BT-123 revisão", "comentar BT-123 texto…").
 * Sem I/O — só reconhece a intenção e devolve os campos já normalizados;
 * quem resolve status/usuário/executa a ação é o CommandPalette.
 */

export type QuickAction =
  | { kind: 'move'; key: string; statusQuery: string }
  | { kind: 'assign'; key: string; assigneeQuery: string; toMe: boolean }
  | { kind: 'worklog'; key: string; timeSpent: string; comment: string | null }
  | { kind: 'comment'; key: string; body: string }

export const QUICK_ACTION_VERBS = ['mover', 'atribuir', 'apontar', 'comentar'] as const
export type QuickActionVerb = (typeof QUICK_ACTION_VERBS)[number]

/**
 * Verbo de ação já digitado, mas comando ainda incompleto/inválido —
 * a palette usa isso para mostrar a sintaxe em vez de cair na busca comum.
 */
export function quickActionVerb(raw: string): QuickActionVerb | null {
  const first = raw.trim().split(/\s+/)[0]?.toLowerCase()
  return (QUICK_ACTION_VERBS as readonly string[]).includes(first)
    ? (first as QuickActionVerb)
    : null
}

const KEY_RE = /^[a-z][a-z0-9]*-\d+$/i
const TIME_TOKEN_RE = /^(\d+[wdhm])+$/i
const TIME_PART_RE = /\d+[wdhm]/gi
const TO_ME_QUERIES = new Set(['mim', 'para mim', 'a mim', 'eu', 'me'])

/** '1h30m' -> '1h 30m' (formato Jira, com espaços entre unidades). */
function normalizeTimeSpent(token: string): string {
  return token.match(TIME_PART_RE)?.join(' ') ?? token
}

export function parseQuickAction(raw: string): QuickAction | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tokens = trimmed.split(/\s+/)
  const verb = tokens[0].toLowerCase()

  switch (verb) {
    case 'mover': {
      const key = tokens[1]
      if (!key || !KEY_RE.test(key)) return null
      const statusQuery = tokens.slice(2).join(' ').trim()
      if (!statusQuery) return null
      return { kind: 'move', key: key.toUpperCase(), statusQuery }
    }
    case 'atribuir': {
      const key = tokens[1]
      if (!key || !KEY_RE.test(key)) return null
      const rest = tokens.slice(2).join(' ').trim()
      if (!rest) return null
      return {
        kind: 'assign',
        key: key.toUpperCase(),
        assigneeQuery: rest,
        toMe: TO_ME_QUERIES.has(rest.toLowerCase())
      }
    }
    case 'apontar': {
      const timeToken = tokens[1]
      const key = tokens[2]
      if (!timeToken || !TIME_TOKEN_RE.test(timeToken)) return null
      if (!key || !KEY_RE.test(key)) return null
      const comment = tokens.slice(3).join(' ').trim()
      return {
        kind: 'worklog',
        key: key.toUpperCase(),
        timeSpent: normalizeTimeSpent(timeToken),
        comment: comment || null
      }
    }
    case 'comentar': {
      const key = tokens[1]
      if (!key || !KEY_RE.test(key)) return null
      const body = tokens.slice(2).join(' ').trim()
      if (!body) return null
      return { kind: 'comment', key: key.toUpperCase(), body }
    }
    default:
      return null
  }
}
