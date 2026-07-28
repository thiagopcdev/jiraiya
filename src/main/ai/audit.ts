/**
 * Redação do que vai para a auditoria (command_log).
 * Regra dura: o log é para o usuário auditar O QUE o app executou — nunca
 * pode carregar segredo (API key, header de auth) nem prompt inteiro.
 * Puro, sem dependências.
 */

const DEFAULT_MAX_PROMPT_LEN = 300

/**
 * Linha de comando legível: binário + args, com qualquer arg longo (o prompt,
 * na prática) truncado. O env NUNCA entra — é lá que vivem tokens herdados.
 */
export function redactCommandLine(
  binary: string,
  args: string[],
  maxPromptLen = DEFAULT_MAX_PROMPT_LEN
): string {
  const parts = [binary, ...args].map((part) =>
    part.length > maxPromptLen
      ? `${part.slice(0, maxPromptLen)}… (+${part.length - maxPromptLen} chars)`
      : part
  )
  return parts.join(' ')
}

/** Descrição de uma chamada HTTP a provider: método, URL e modelo. Sem headers/key. */
export function describeHttpCall(method: string, url: string, model: string): string {
  return `${method} ${url} model=${model}`
}
