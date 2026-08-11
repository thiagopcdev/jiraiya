import { describe, expect, it } from 'vitest'
import { pruneMentions, toDisplay, toMarkdown } from './mentionText'

describe('toDisplay', () => {
  it('tira a sintaxe do campo e guarda o accountId de lado', () => {
    expect(toDisplay('oi @[Thiago Prado](557058:abc), olha')).toEqual({
      text: 'oi @Thiago Prado, olha',
      mentions: { 'Thiago Prado': '557058:abc' }
    })
  })

  it('texto sem menção passa intacto', () => {
    expect(toDisplay('fala com thiago@biud.com.br')).toEqual({
      text: 'fala com thiago@biud.com.br',
      mentions: {}
    })
  })
})

describe('toMarkdown', () => {
  const mentions = { 'Thiago Prado': '557058:abc', Ana: 'a1', 'Ana Lúcia': 'a2' }

  it('reidrata a menção escolhida', () => {
    expect(toMarkdown('oi @Thiago Prado, olha', mentions)).toBe(
      'oi @[Thiago Prado](557058:abc), olha'
    )
  })

  it('nome mais longo ganha — "Ana" não come o começo de "Ana Lúcia"', () => {
    expect(toMarkdown('@Ana Lúcia e @Ana', mentions)).toBe('@[Ana Lúcia](a2) e @[Ana](a1)')
  })

  it('"@" digitado à mão continua texto: não marca quem não foi escolhido', () => {
    expect(toMarkdown('avisa o @Bruno', mentions)).toBe('avisa o @Bruno')
  })

  it('não marca no meio de palavra (e-mail)', () => {
    expect(toMarkdown('thiago@Ana.com', mentions)).toBe('thiago@Ana.com')
  })

  it('sem menções devolve o texto como está', () => {
    expect(toMarkdown('oi @Thiago Prado', {})).toBe('oi @Thiago Prado')
  })

  it('ida e volta preserva o accountId', () => {
    const original = 'oi @[Thiago Prado](557058:abc) e @[Ana](a1)'
    const { text, mentions: map } = toDisplay(original)
    expect(text).toBe('oi @Thiago Prado e @Ana')
    expect(toMarkdown(text, map)).toBe(original)
  })
})

describe('pruneMentions', () => {
  it('menção apagada do texto sai do mapa', () => {
    expect(pruneMentions('só @Ana agora', { Ana: 'a1', Bruno: 'b1' })).toEqual({ Ana: 'a1' })
  })
})
