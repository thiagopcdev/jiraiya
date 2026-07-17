import type { SummaryTemplate } from '@shared/domain'
import type { DigestItem, PeriodDigest } from '../selectors'

/** Templates determinísticos: PeriodDigest -> markdown pt-BR. */

function line(item: DigestItem): string {
  const detail = item.detail ? ` _(${item.detail})_` : ''
  return `- **${item.key}** — ${item.summary}${detail}`
}

function section(title: string, items: DigestItem[], emptyText?: string): string {
  if (items.length === 0) {
    return emptyText ? `**${title}**\n\n${emptyText}\n` : ''
  }
  return `**${title}**\n\n${items.map(line).join('\n')}\n`
}

export function standupTemplate(digest: PeriodDigest): string {
  const ontemItems = [...digest.concluidos, ...digest.avancaram, ...digest.comentados]
  const parts: string[] = []

  parts.push(
    section('Ontem fiz', dedupe(ontemItems), '_Sem registros no período._'),
    section('Hoje pretendo', digest.emAndamento, '_Nada em andamento atribuído a mim._')
  )

  const bloqueios = [
    ...digest.bloqueados,
    ...digest.paradosHaDias.map((i) => ({ ...i, detail: `parado há ${i.dias} dias` }))
  ]
  parts.push(
    bloqueios.length > 0
      ? section('Bloqueios', dedupe(bloqueios))
      : '**Bloqueios**\n\n_Sem bloqueios._\n'
  )

  return header('Daily', digest) + parts.filter(Boolean).join('\n')
}

export function weeklyTemplate(digest: PeriodDigest): string {
  const parts: string[] = [
    section('Entregas concluídas', digest.concluidos, '_Nenhuma entrega concluída no período._'),
    section('Em progresso', dedupe([...digest.avancaram, ...digest.emAndamento])),
    section(
      'Riscos e bloqueios',
      dedupe([
        ...digest.bloqueados,
        ...digest.paradosHaDias.map((i) => ({ ...i, detail: `parado há ${i.dias} dias` }))
      ])
    )
  ]
  if (digest.sprintAtual) {
    parts.push(
      `**Próximos passos**\n\n- Sprint ${digest.sprintAtual.nome}: ${digest.sprintAtual.abertas} issue(s) abertas${
        digest.sprintAtual.fim ? ` até ${formatDate(digest.sprintAtual.fim)}` : ''
      }\n`
    )
  }
  return header('Resumo semanal', digest) + parts.filter(Boolean).join('\n')
}

export function oneOnOneTemplate(digest: PeriodDigest): string {
  const parts: string[] = [
    section('Destaques', digest.concluidos, '_Sem entregas concluídas no período._'),
    section(
      'Desafios',
      dedupe([
        ...digest.bloqueados,
        ...digest.paradosHaDias.map((i) => ({ ...i, detail: `parado há ${i.dias} dias` }))
      ]),
      '_Sem desafios relevantes._'
    ),
    section('Em andamento / próximos passos', digest.emAndamento)
  ]
  return header('Notas para 1:1', digest) + parts.filter(Boolean).join('\n')
}

export function monthlyTemplate(digest: PeriodDigest): string {
  const parts: string[] = [
    `**Números do período**\n\n- Concluídas: ${digest.concluidos.length}\n- Movimentadas: ${digest.avancaram.length}\n- Comentadas: ${digest.comentados.length}\n- Criadas: ${digest.criados.length}\n`,
    section('Entregas', digest.concluidos),
    section('Trabalho em andamento', digest.emAndamento)
  ]
  return header('Resumo mensal', digest) + parts.filter(Boolean).join('\n')
}

function header(title: string, digest: PeriodDigest): string {
  return `## ${title} — ${digest.periodLabel}\n\n`
}

function dedupe<T extends DigestItem>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((i) => {
    if (seen.has(i.key)) return false
    seen.add(i.key)
    return true
  })
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(
    new Date(iso)
  )
}

export const templates: Record<SummaryTemplate, (digest: PeriodDigest) => string> = {
  standup: standupTemplate,
  weekly: weeklyTemplate,
  one_on_one: oneOnOneTemplate,
  monthly: monthlyTemplate
}
