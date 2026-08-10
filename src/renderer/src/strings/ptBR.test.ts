import { describe, expect, it } from 'vitest'
import { t } from './ptBR'

/** As chaves-função de `t` não são exercitadas por nenhuma tela isoladamente
 * (cada uma só aparece formatada dentro de um componente específico) — este
 * teste garante que a interpolação de cada uma está correta, sem precisar
 * montar toda a árvore de componentes que as usa. */
describe('strings/ptBR — chaves-função', () => {
  it('app.updateAvailable', () => {
    expect(t.app.updateAvailable('2.1.0')).toBe('v2.1.0 disponível')
  })

  it('sync.lastSync', () => {
    expect(t.sync.lastSync('há 5 min')).toBe('Sincronizado há 5 min')
  })

  it('onboarding.connected', () => {
    expect(t.onboarding.connected('Fulano')).toBe('Conectado como Fulano')
  })

  it('create.aiUnavailableHint (com e sem provider)', () => {
    expect(t.create.aiUnavailableHint('Claude')).toBe('Claude indisponível — verifique em Ajustes')
    expect(t.create.aiUnavailableHint(null)).toBe(
      'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
    )
  })

  it('create.addToActiveSprint', () => {
    expect(t.create.addToActiveSprint('Sprint 42')).toBe('Adicionar à sprint ativa — Sprint 42')
  })

  it('create.createdTitle', () => {
    expect(t.create.createdTitle('BT-123')).toBe('Task BT-123 criada')
  })

  it('split.analyze (com e sem provider)', () => {
    expect(t.split.analyze('Gemini')).toBe('Analisar com Gemini')
    expect(t.split.analyze(null)).toBe('Analisar com IA')
  })

  it('split.aiUnavailableHint', () => {
    expect(t.split.aiUnavailableHint('Codex')).toBe('Codex indisponível — verifique em Ajustes')
    expect(t.split.aiUnavailableHint(null)).toBe(
      'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
    )
  })

  it('split.refine', () => {
    expect(t.split.refine('Claude')).toBe('Refinar com Claude')
    expect(t.split.refine(null)).toBe('Refinar com IA')
  })

  it('split.submit (singular e plural)', () => {
    expect(t.split.submit(1)).toBe('Criar 1 card no Jira')
    expect(t.split.submit(3)).toBe('Criar 3 cards no Jira')
  })

  it('split.createdTitle (singular e plural)', () => {
    expect(t.split.createdTitle(1, 'BT-1')).toBe('1 card criado a partir de BT-1')
    expect(t.split.createdTitle(2, 'BT-1')).toBe('2 cards criados a partir de BT-1')
  })

  it('ask.aiUnavailableHint', () => {
    expect(t.ask.aiUnavailableHint('Claude')).toBe('Claude indisponível — verifique em Ajustes')
    expect(t.ask.aiUnavailableHint(null)).toBe(
      'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
    )
  })

  it('filters.resultsCount (singular e plural)', () => {
    expect(t.filters.resultsCount(1)).toBe('1 resultado')
    expect(t.filters.resultsCount(0)).toBe('0 resultados')
    expect(t.filters.resultsCount(5)).toBe('5 resultados')
  })

  it('board.sprintFallbackName', () => {
    expect(t.board.sprintFallbackName(42)).toBe('Sprint 42')
  })

  it('detail.storyPoints', () => {
    expect(t.detail.storyPoints(5)).toBe('5 pts')
  })

  it('detail.aiUnavailableHint', () => {
    expect(t.detail.aiUnavailableHint('Claude')).toBe('Claude indisponível — verifique em Ajustes')
    expect(t.detail.aiUnavailableHint(null)).toBe(
      'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
    )
  })

  it('detail.timeSpentRegistered (com valor e nulo)', () => {
    expect(t.detail.timeSpentRegistered('2h')).toBe('Registrado: 2h')
    expect(t.detail.timeSpentRegistered(null)).toBe('Registrado: —')
  })

  it('detail.subtasksTitle', () => {
    expect(t.detail.subtasksTitle(0)).toBe('Subtarefas (0)')
    expect(t.detail.subtasksTitle(4)).toBe('Subtarefas (4)')
  })
})
