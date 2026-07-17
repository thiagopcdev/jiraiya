export function statusColor(category: string | null | undefined): 'zinc' | 'blue' | 'green' {
  if (category === 'done') return 'green'
  if (category === 'indeterminate') return 'blue'
  return 'zinc'
}
