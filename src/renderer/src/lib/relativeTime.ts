/**
 * Tempo relativo compacto em pt-BR para caber na sidebar estreita.
 * Ex.: "agora", "há 3 min", "há 2 h", "há 5 d".
 * (O date-fns gera textos longos como "há menos de um minuto".)
 */
export function compactAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} d`
}
