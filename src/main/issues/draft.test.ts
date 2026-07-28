import { describe, expect, it } from 'vitest'
import { parseDraftResponse } from './draft'

describe('parseDraftResponse', () => {
  it('JSON puro com title e description, com trim em ambos', () => {
    const raw = '{"title":" Título da task ","description":" Descrição da task "}'
    expect(parseDraftResponse(raw)).toEqual({
      title: 'Título da task',
      description: 'Descrição da task'
    })
  })

  it('recorta o JSON de dentro de uma cerca de código ```json', () => {
    const raw = '```json\n{"title":"Título","description":"Descrição"}\n```'
    expect(parseDraftResponse(raw)).toEqual({ title: 'Título', description: 'Descrição' })
  })

  it('recorta o JSON quando há preâmbulo de texto antes', () => {
    const raw = 'Claro! Aqui está:\n{"title":"Título","description":"Descrição"}'
    expect(parseDraftResponse(raw)).toEqual({ title: 'Título', description: 'Descrição' })
  })

  it('title vazio lança erro de formato inesperado', () => {
    expect(() => parseDraftResponse('{"title":"","description":"Descrição"}')).toThrow(
      'Resposta da IA em formato inesperado'
    )
  })

  it('title só com espaços/whitespace lança erro de formato inesperado', () => {
    expect(() => parseDraftResponse('{"title":"   ","description":"Descrição"}')).toThrow(
      'Resposta da IA em formato inesperado'
    )
  })

  it('title muito longo (300 chars) lança erro de formato inesperado', () => {
    const longTitle = 'a'.repeat(300)
    expect(() => parseDraftResponse(`{"title":"${longTitle}","description":"Descrição"}`)).toThrow(
      'Resposta da IA em formato inesperado'
    )
  })

  it('raw sem nenhum JSON lança erro de formato inesperado', () => {
    expect(() => parseDraftResponse('não sei')).toThrow('Resposta da IA em formato inesperado')
  })

  it('JSON sem campo description lança erro de formato inesperado', () => {
    expect(() => parseDraftResponse('{"title":"Título"}')).toThrow(
      'Resposta da IA em formato inesperado'
    )
  })
})
