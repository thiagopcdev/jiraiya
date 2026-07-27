/**
 * Deriva um nome de branch git a partir de um card: '<prefixo>/<KEY>-<slug>'.
 *
 * prefixo: 'fix' quando issueType casa /bug|defeito/i; senão 'feat'.
 *
 * slug: summary sem prefixos '[ÁREA]' iniciais (um ou mais blocos [..] no
 * começo), em minúsculas, sem acentos (NFD + remoção de diacríticos),
 * qualquer sequência que não seja [a-z0-9] vira '-', sem '-' nas pontas.
 * O slug é truncado (sem '-' final) para manter o branch inteiro dentro de
 * um limite razoável de tamanho — na prática, ~40 caracteres de slug para
 * uma key/prefixo de tamanho típico.
 */
const MAX_BRANCH_LENGTH = 49

/** Remove diacríticos via NFD (ex.: 'público' -> 'publico'). */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Remove um ou mais blocos '[..]' do início do texto (ex.: '[Segurança] [Urgente] Foo' -> 'Foo'). */
function stripLeadingAreaTags(summary: string): string {
  return summary.replace(/^(\s*\[[^\]]*\]\s*)+/, '')
}

/** minúsculas + sem acentos + não [a-z0-9] vira '-' + sem '-' nas pontas. */
function slugify(value: string): string {
  const lowered = stripDiacritics(value.toLowerCase())
  const dashed = lowered.replace(/[^a-z0-9]+/g, '-')
  return dashed.replace(/^-+|-+$/g, '')
}

/**
 * Nome de branch a partir do card: '<prefixo>/<KEY>-<slug>'.
 * prefixo: issueType casando /bug|defeito/i → 'fix'; senão 'feat'.
 * slug: summary sem prefixos '[ÁREA]' iniciais (um ou mais blocos [..] no começo),
 * minúsculas, sem acentos (NFD + remoção de diacríticos), qualquer sequência
 * não [a-z0-9] vira '-', sem '-' nas pontas, truncado (sem '-' final) para o
 * branch inteiro caber num limite razoável de tamanho.
 */
export function branchName(issueType: string | null, key: string, summary: string): string {
  const prefix = issueType !== null && /bug|defeito/i.test(issueType) ? 'fix' : 'feat'
  const fullSlug = slugify(stripLeadingAreaTags(summary))

  const head = `${prefix}/${key}-`
  const maxSlugLength = Math.max(0, MAX_BRANCH_LENGTH - head.length)
  const slug = fullSlug.slice(0, maxSlugLength).replace(/-+$/, '')

  return slug ? `${head}${slug}` : `${prefix}/${key}`
}
