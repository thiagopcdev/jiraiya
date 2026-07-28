import { describe, expect, it } from 'vitest'
import { parseSplitResponse } from './split'

describe('parseSplitResponse', () => {
  it('JSON puro com items e rationale', () => {
    const raw = '{"items":[{"title":"A","description":"d"}],"rationale":"por camada"}'
    expect(parseSplitResponse(raw)).toEqual({
      items: [{ title: 'A', description: 'd' }],
      rationale: 'por camada'
    })
  })

  it('recorta o JSON de dentro de uma cerca de código ```json', () => {
    const raw = '```json\n{"items":[{"title":"A","description":"d"}],"rationale":"r"}\n```'
    expect(parseSplitResponse(raw)).toEqual({
      items: [{ title: 'A', description: 'd' }],
      rationale: 'r'
    })
  })

  it('recorta o JSON quando há preâmbulo de texto antes', () => {
    const raw =
      'Claro! Aqui está a divisão:\n{"items":[{"title":"A","description":"d"}],"rationale":"r"}'
    expect(parseSplitResponse(raw)).toEqual({
      items: [{ title: 'A', description: 'd' }],
      rationale: 'r'
    })
  })

  it('rationale ausente retorna string vazia sem lançar', () => {
    const raw = '{"items":[{"title":"A","description":"d"}]}'
    expect(parseSplitResponse(raw)).toEqual({
      items: [{ title: 'A', description: 'd' }],
      rationale: ''
    })
  })

  it('items vazio ([]) lança erro de formato inesperado', () => {
    const raw = '{"items":[],"rationale":"r"}'
    expect(() => parseSplitResponse(raw)).toThrow('Resposta da IA em formato inesperado')
  })

  it('11 itens (acima do máximo de 10) lança erro de formato inesperado', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ title: `Item ${i}`, description: 'd' }))
    const raw = JSON.stringify({ items, rationale: 'r' })
    expect(() => parseSplitResponse(raw)).toThrow('Resposta da IA em formato inesperado')
  })

  it('item com title vazio lança erro de formato inesperado', () => {
    const raw = '{"items":[{"title":"","description":"d"}],"rationale":"r"}'
    expect(() => parseSplitResponse(raw)).toThrow('Resposta da IA em formato inesperado')
  })

  it('item com title só espaços/whitespace lança erro de formato inesperado', () => {
    const raw = '{"items":[{"title":"   ","description":"d"}],"rationale":"r"}'
    expect(() => parseSplitResponse(raw)).toThrow('Resposta da IA em formato inesperado')
  })

  it('title acima de 255 chars lança erro de formato inesperado', () => {
    const longTitle = 'a'.repeat(256)
    const raw = `{"items":[{"title":"${longTitle}","description":"d"}],"rationale":"r"}`
    expect(() => parseSplitResponse(raw)).toThrow('Resposta da IA em formato inesperado')
  })

  it('raw sem nenhum JSON lança erro de formato inesperado', () => {
    expect(() => parseSplitResponse('não sei')).toThrow('Resposta da IA em formato inesperado')
  })

  it('title com espaços nas pontas é trimado', () => {
    const raw = '{"items":[{"title":" Título com espaços ","description":"d"}],"rationale":"r"}'
    const result = parseSplitResponse(raw)
    expect(result.items[0].title).toBe('Título com espaços')
  })

  it('description tem espaços das pontas removidos (consistente com parseDraftResponse)', () => {
    const raw =
      '{"items":[{"title":"A","description":"  descrição com espaços  "}],"rationale":"r"}'
    const result = parseSplitResponse(raw)
    expect(result.items[0].description).toBe('descrição com espaços')
  })
})
