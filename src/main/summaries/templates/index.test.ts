import { describe, expect, it } from 'vitest'
import { templates } from './index'
import type { DigestItem, PeriodDigest } from '../selectors'

const item = (key: string, summary: string, detail?: string): DigestItem => ({
  key,
  summary,
  url: `https://x.atlassian.net/browse/${key}`,
  detail
})

const digest: PeriodDigest = {
  periodLabel: 'Últimos 7 dias',
  concluidos: [item('BT-10', 'Corrigir login SSO')],
  avancaram: [item('BT-11', 'Refatorar webhooks', 'To Do → In Progress')],
  comentados: [item('BT-12', 'Investigar lentidão do relatório')],
  criados: [item('BT-13', 'Spike de cache')],
  emAndamento: [item('BT-11', 'Refatorar webhooks', 'In Progress')],
  paraHoje: [item('BT-11', 'Refatorar webhooks', 'In Progress')],
  aguardando: [item('BT-16', 'Endpoint sem auth', 'PRONTO PARA TESTE')],
  bloqueados: [item('BT-14', 'Migração de banco', 'Highest')],
  paradosHaDias: [{ ...item('BT-15', 'Ajuste de layout'), dias: 5 }],
  sprintAtual: { nome: 'Sprint 42', fim: '2026-07-20T00:00:00.000Z', abertas: 4 }
}

const empty: PeriodDigest = {
  periodLabel: 'Hoje',
  concluidos: [],
  avancaram: [],
  comentados: [],
  criados: [],
  emAndamento: [],
  paraHoje: [],
  aguardando: [],
  bloqueados: [],
  paradosHaDias: [],
  sprintAtual: null
}

describe('templates', () => {
  it('standup tem as 3 seções e as chaves dos tickets', () => {
    const md = templates.standup(digest)
    expect(md).toContain('## Daily — Últimos 7 dias')
    expect(md).toContain('**Ontem fiz**')
    expect(md).toContain('**Hoje pretendo**')
    expect(md).toContain('**Bloqueios**')
    expect(md).toContain('BT-10')
    expect(md).toContain('BT-11')
    expect(md).toContain('parado há 5 dias')
  })

  it('standup: "Hoje pretendo" usa paraHoje e estados de espera vão para "Aguardando"', () => {
    const md = templates.standup(digest)
    // BT-16 (PRONTO PARA TESTE) não pode aparecer em "Hoje pretendo"
    const hojeSection = md.split('**Hoje pretendo**')[1].split('**Aguardando')[0]
    expect(hojeSection).toContain('BT-11')
    expect(hojeSection).not.toContain('BT-16')
    expect(md).toContain('**Aguardando (bola com terceiros)**')
    expect(md).toContain('BT-16')
  })

  it('standup vazio usa placeholders e não quebra', () => {
    const md = templates.standup(empty)
    expect(md).toContain('_Sem registros no período._')
    expect(md).toContain('_Sem bloqueios._')
    expect(md).toContain('_Nada puxado — sugestão: pegar um item do backlog._')
    expect(md).not.toContain('**Aguardando')
  })

  it('weekly inclui entregas, riscos e próximos passos com sprint', () => {
    const md = templates.weekly(digest)
    expect(md).toContain('**Entregas concluídas**')
    expect(md).toContain('**Riscos e bloqueios**')
    expect(md).toContain('Sprint Sprint 42: 4 issue(s) abertas')
  })

  it('one_on_one e monthly geram markdown com contagens corretas', () => {
    expect(templates.one_on_one(digest)).toContain('**Destaques**')
    const monthly = templates.monthly(digest)
    expect(monthly).toContain('- Concluídas: 1')
    expect(monthly).toContain('- Criadas: 1')
  })

  it('não duplica issue presente em avancaram e emAndamento', () => {
    const md = templates.weekly(digest)
    const occurrences = md.match(/BT-11/g) ?? []
    expect(occurrences).toHaveLength(1)
  })
})
