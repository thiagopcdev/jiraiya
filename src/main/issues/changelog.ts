import type { ChangelogEntry } from '@shared/domain'

/** Uma entrada crua do changelog do Jira (`/issue/{key}/changelog` → values[]). */
export interface RawChangelogHistory {
  id: string
  author?: { displayName?: string } | null
  created: string
  items?: Array<{
    field?: string
    fieldId?: string
    fromString?: string | null
    toString?: string | null
  }>
}

/**
 * Rótulos em pt-BR por campo. A chave é comparada em minúsculas contra `field`
 * e `fieldId` (o Jira manda o nome legível em `field` e o id em `fieldId`).
 */
const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  assignee: 'Responsável',
  priority: 'Prioridade',
  summary: 'Título',
  description: 'Descrição',
  resolution: 'Resolução',
  sprint: 'Sprint',
  labels: 'Labels',
  duedate: 'Data limite',
  timeestimate: 'Estimativa',
  timespent: 'Tempo registrado',
  attachment: 'Anexo',
  link: 'Vínculo',
  'story point estimate': 'Story points',
  'story points': 'Story points',
  issuetype: 'Tipo',
  'fix version': 'Versão de correção',
  remoteissuelink: 'Vínculo'
}

/** Primeira letra em maiúscula, resto intacto (fallback de rótulo). */
function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

/** Rótulo do campo: mapa por field/fieldId (case-insensitive) ou o cru capitalizado. */
function labelFor(field: string | undefined, fieldId: string | undefined): string {
  const raw = field ?? fieldId ?? ''
  const byField = field ? FIELD_LABELS[field.toLowerCase()] : undefined
  const byFieldId = fieldId ? FIELD_LABELS[fieldId.toLowerCase()] : undefined
  return byField ?? byFieldId ?? capitalize(raw)
}

/** 'Rank' é ruído de reordenação de backlog — não vira histórico. */
function isNoise(field: string | undefined, fieldId: string | undefined): boolean {
  return field?.toLowerCase() === 'rank' || fieldId?.toLowerCase() === 'rank'
}

/** Timestamp para ordenação; data inválida vai para o fim (0). */
function timeOf(created: string): number {
  const parsed = Date.parse(created)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Mapeia o changelog cru para o histórico consumido pelo renderer: mais recente
 * primeiro, sem itens irrelevantes (sem campo ou 'Rank') e com rótulos em pt-BR.
 * Entrada que fica sem nenhum item é descartada.
 */
export function mapChangelog(histories: RawChangelogHistory[]): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  for (const history of histories) {
    const items: ChangelogEntry['items'] = []
    for (const item of history.items ?? []) {
      // item sem nenhuma identificação de campo não é exibível
      if (!item.field && !item.fieldId) continue
      if (isNoise(item.field, item.fieldId)) continue
      items.push({
        field: labelFor(item.field, item.fieldId),
        from: item.fromString ?? null,
        to: item.toString ?? null
      })
    }
    if (items.length === 0) continue
    entries.push({
      id: history.id,
      authorName: history.author?.displayName ?? null,
      createdAt: history.created,
      items
    })
  }
  return entries.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))
}
