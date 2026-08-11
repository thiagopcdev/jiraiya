/**
 * Duas formas do mesmo texto:
 *
 * - **markdown** é o que viaja para o Jira e o que fica gravado no rascunho:
 *   `@[Thiago Prado](557058:abc)`. O accountId é obrigatório — sem ele o Jira
 *   trata como texto e a pessoa não é notificada.
 * - **exibição** é o que o usuário vê e edita no campo: `@Thiago Prado`, como
 *   o Jira mostra depois de marcar.
 *
 * O id fica fora do texto, num mapa nome→accountId que acompanha o compositor.
 * Puro de propósito: nada de React ou IPC aqui.
 */

/** nome exibido → accountId */
export type MentionMap = Record<string, string>

const MARKDOWN_RE = /@\[([^\]\n]+)\]\(([A-Za-z0-9:_-]+)\)/g

/** Markdown → o que o campo mostra, junto do mapa para desfazer depois. */
export function toDisplay(markdown: string): { text: string; mentions: MentionMap } {
  const mentions: MentionMap = {}
  const text = markdown.replace(MARKDOWN_RE, (_all, name: string, id: string) => {
    mentions[name] = id
    return `@${name}`
  })
  return { text, mentions }
}

/** true quando o caractere não pode fazer parte de um nome (fim da menção). */
function isBoundary(char: string | undefined): boolean {
  return char === undefined || !/[\p{L}\p{N}]/u.test(char)
}

/**
 * Exibição → markdown, reidratando só os nomes que foram de fato escolhidos no
 * menu. `@` digitado à mão continua texto puro: marcar alguém por semelhança de
 * nome poderia notificar a pessoa errada.
 *
 * Nomes mais longos primeiro, senão "Ana" consumiria o começo de "Ana Lúcia".
 */
export function toMarkdown(text: string, mentions: MentionMap): string {
  const names = Object.keys(mentions).sort((a, b) => b.length - a.length)
  if (names.length === 0) return text

  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '@' && isBoundary(text[i - 1])) {
      const name = names.find(
        (candidate) =>
          text.startsWith(candidate, i + 1) && isBoundary(text[i + 1 + candidate.length])
      )
      if (name) {
        out += `@[${name}](${mentions[name]})`
        i += name.length + 1
        continue
      }
    }
    out += text[i]
    i += 1
  }
  return out
}

/** Mapa só com quem ainda aparece no texto — evita reidratar menção apagada. */
export function pruneMentions(text: string, mentions: MentionMap): MentionMap {
  const kept: MentionMap = {}
  for (const [name, id] of Object.entries(mentions)) {
    if (text.includes(`@${name}`)) kept[name] = id
  }
  return kept
}
