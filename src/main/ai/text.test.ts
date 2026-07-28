import { describe, expect, it } from 'vitest'
import { extractJson, stripOuterCodeFence } from './text'

describe('stripOuterCodeFence', () => {
  it('remove fence externo com linguagem', () => {
    expect(stripOuterCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('remove fence externo sem linguagem', () => {
    expect(stripOuterCodeFence('```\ntexto\n```')).toBe('texto')
  })

  it('sem fence devolve o texto com trim', () => {
    expect(stripOuterCodeFence('  texto solto  ')).toBe('texto solto')
  })

  it('fence interno (não envolve tudo) é preservado', () => {
    const texto = 'antes\n```js\ncode\n```\ndepois'
    expect(stripOuterCodeFence(texto)).toBe(texto.trim())
  })
})

describe('extractJson', () => {
  it('extrai objeto de dentro de um fence json com texto ao redor', () => {
    const texto = 'Aqui está:\n```json\n{"x":[1,2]}\n```\nEspero que ajude'
    expect(extractJson(texto)).toBe('{"x":[1,2]}')
  })

  it('extrai array solto em meio a texto', () => {
    expect(extractJson('bla [1,2,3] bla')).toBe('[1,2,3]')
  })

  it('sem delimitadores devolve o texto pós-strip', () => {
    expect(extractJson('  não tem json aqui  ')).toBe('não tem json aqui')
  })

  it('recorta do primeiro { ou [ ao último } ou ]', () => {
    const texto = 'lixo antes { "a": 1, "b": [1,2] } lixo depois'
    expect(extractJson(texto)).toBe('{ "a": 1, "b": [1,2] }')
  })
})
