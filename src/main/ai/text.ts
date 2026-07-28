/**
 * Normalização do texto que volta dos providers de IA.
 * Modelos gostam de embalar a resposta inteira num bloco de código mesmo
 * quando pedimos "só o markdown" / "só o JSON" — aqui a casca é removida.
 * Sem dependências: puro, fácil de testar.
 */

/**
 * Remove UM fence ``` (com ou sem linguagem) que envolva a saída INTEIRA.
 * Fences internos (blocos de código dentro da resposta) são preservados.
 * Sem fence externo → devolve o texto apenas trimado.
 */
export function stripOuterCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```') || trimmed.length < 7) return trimmed

  const firstBreak = trimmed.indexOf('\n')
  // ```algo``` numa linha só não é bloco envolvente
  if (firstBreak === -1) return trimmed

  // a linha de abertura só pode trazer a linguagem (ex.: ```json)
  const language = trimmed.slice(3, firstBreak).trim()
  if (language.includes('`') || /\s/.test(language)) return trimmed

  return trimmed.slice(firstBreak + 1, -3).trim()
}

/**
 * Recorta o JSON de uma resposta: tira o fence externo e mantém do primeiro
 * '{'/'[' ao último '}'/']' (modelos costumam prefixar/sufixar comentários).
 * Sem delimitadores, devolve o texto pós-strip — o JSON.parse de quem chama
 * falha naturalmente com a mensagem do caso de uso.
 */
export function extractJson(text: string): string {
  const stripped = stripOuterCodeFence(text)

  const candidates = [stripped.indexOf('{'), stripped.indexOf('[')].filter((i) => i !== -1)
  if (candidates.length === 0) return stripped
  const start = Math.min(...candidates)

  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'))
  if (end <= start) return stripped

  return stripped.slice(start, end + 1)
}
