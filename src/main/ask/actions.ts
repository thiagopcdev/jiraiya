import type { AskAction } from '@shared/domain'

/**
 * Protocolo de ações do "Pergunte ao Jiraiya": o Claude pode PROPOR ações,
 * que só são executadas depois de confirmação explícita do usuário na UI.
 */

/** Marcador de início do bloco de ações na resposta do Claude. */
const MARKER = '===ACOES==='

/** Máximo de ações aceitas num bloco (o excedente é descartado). */
const MAX_ACTIONS = 5

const VALID_TYPES = ['move_status', 'assign_me', 'comment', 'log_work', 'set_story_points'] as const

type AskActionType = AskAction['type']

/** Instrução anexada ao prompt do ask descrevendo o protocolo de ações. */
export const ACTIONS_PROMPT = [
  '=== AÇÕES ===',
  'Se o usuário pedir uma AÇÃO no Jira (mover status, atribuir o card a ele, comentar,',
  'registrar tempo ou mudar story points), termine a resposta com uma linha contendo',
  `exatamente ${MARKER} e, na sequência, um array JSON com as ações propostas:`,
  '',
  MARKER,
  '[{"type":"move_status","key":"BT-1","statusName":"Em teste"}]',
  '',
  'Tipos válidos e seus campos:',
  '- move_status: key + statusName (nome do status de destino);',
  '- assign_me: key (atribui o card ao usuário conectado);',
  '- comment: key + text (texto do comentário);',
  '- log_work: key + timeSpent (formato Jira, ex. "1h 30m");',
  '- set_story_points: key + storyPoints (número).',
  '',
  'Regras do bloco:',
  '- NUNCA invente keys: use apenas keys que aparecem no snapshot;',
  `- no máximo ${MAX_ACTIONS} ações, uma por item do array;`,
  '- o texto antes do marcador deve explicar em português o que será feito;',
  '- se o usuário não pediu nenhuma ação (só uma pergunta), NÃO emita o bloco.'
].join('\n')

/**
 * Extrai o bloco de ações da resposta do Claude.
 * Protocolo: a resposta pode terminar com uma linha '===ACOES===' seguida de um
 * array JSON de ações. Retorna { answer: <texto sem o bloco, trimado>, actions: [...] }.
 * Sem bloco → actions []. JSON inválido ou não-array → actions [] (answer preserva só o texto).
 */
export function parseAskResponse(raw: string): { answer: string; actions: AskAction[] } {
  const text = raw ?? ''
  const idx = text.lastIndexOf(MARKER)
  if (idx === -1) return { answer: text.trim(), actions: [] }

  const answer = text.slice(0, idx).trim()
  const block = text.slice(idx + MARKER.length).trim()

  return { answer, actions: parseActionsBlock(block) }
}

/** Faz o parse do JSON do bloco e valida/normaliza cada item. */
function parseActionsBlock(block: string): AskAction[] {
  const json = stripCodeFence(block)
  if (json === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const actions: AskAction[] = []
  for (const item of parsed) {
    const action = normalizeAction(item)
    if (action) actions.push(action)
    if (actions.length >= MAX_ACTIONS) break
  }
  return actions
}

/** Remove cerca de código (```json … ```) que o Claude às vezes adiciona. */
function stripCodeFence(block: string): string {
  const fenced = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(block.trim())
  return (fenced ? fenced[1] : block).trim()
}

/** Valida um item cru; campos extras são ignorados, item inválido → null. */
function normalizeAction(item: unknown): AskAction | null {
  if (typeof item !== 'object' || item === null) return null
  const raw = item as Record<string, unknown>

  const type = raw.type
  if (typeof type !== 'string' || !isValidType(type)) return null

  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  if (key === '') return null

  const action: AskAction = { type, key }

  if (typeof raw.statusName === 'string' && raw.statusName.trim() !== '') {
    action.statusName = raw.statusName.trim()
  }
  if (typeof raw.text === 'string' && raw.text.trim() !== '') {
    action.text = raw.text.trim()
  }
  if (typeof raw.timeSpent === 'string' && raw.timeSpent.trim() !== '') {
    action.timeSpent = raw.timeSpent.trim()
  }
  if (typeof raw.storyPoints === 'number' && Number.isFinite(raw.storyPoints)) {
    action.storyPoints = raw.storyPoints
  }

  return action
}

function isValidType(type: string): type is AskActionType {
  return (VALID_TYPES as readonly string[]).includes(type)
}
