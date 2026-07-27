/**
 * Rascunho automático do comentário em edição na gaveta — persistido em
 * localStorage, um por card. Puro: nenhuma dependência de IPC/React aqui.
 */

const KEY_PREFIX = 'jiraiya.draft.comment.'

function key(issueKey: string): string {
  return `${KEY_PREFIX}${issueKey}`
}

/** null quando não há rascunho salvo (ausente ou vazio). */
export function loadDraft(issueKey: string): string | null {
  try {
    const raw = localStorage.getItem(key(issueKey))
    if (raw === null || raw.trim() === '') return null
    return raw
  } catch {
    return null
  }
}

/** Texto vazio/só espaços remove a chave em vez de gravar string vazia. */
export function saveDraft(issueKey: string, text: string): void {
  try {
    if (text.trim() === '') {
      localStorage.removeItem(key(issueKey))
      return
    }
    localStorage.setItem(key(issueKey), text)
  } catch {
    // localStorage indisponível (ex.: modo privado) — rascunho vira best-effort
  }
}

export function clearDraft(issueKey: string): void {
  try {
    localStorage.removeItem(key(issueKey))
  } catch {
    // idem
  }
}
