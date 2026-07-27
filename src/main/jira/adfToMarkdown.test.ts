import { describe, expect, it } from 'vitest'
import { adfToMarkdown } from './adfToMarkdown'
import { markdownToAdf } from '../issues/markdownToAdf'
import type { AdfNode } from './types'

describe('adfToMarkdown — round-trip com markdownToAdf', () => {
  const casos: string[] = [
    'Olá **mundo**',
    '## Título',
    '- a\n- b',
    '1. um\n2. dois',
    '- [ ] a\n- [x] b',
    '```js\nconst x = 1\n```',
    '> citação',
    '---',
    '[Jira](https://x.com)',
    'a\n\nb',
    '*itálico* e ~~riscado~~ e `code`'
  ]

  for (const md of casos) {
    it(`preserva ${JSON.stringify(md)}`, () => {
      expect(adfToMarkdown(markdownToAdf(md))).toBe(md)
    })
  }
})

describe('adfToMarkdown — casos vazios', () => {
  it('null -> string vazia', () => {
    expect(adfToMarkdown(null)).toBe('')
  })

  it('undefined -> string vazia', () => {
    expect(adfToMarkdown(undefined)).toBe('')
  })

  it('doc sem content -> string vazia', () => {
    expect(adfToMarkdown({ type: 'doc', version: 1, content: [] })).toBe('')
  })
})

describe('adfToMarkdown — nós especiais', () => {
  it('mediaGroup entre dois parágrafos vira "(anexo)" entre os dois textos', () => {
    const doc: AdfNode = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'antes' }] },
        { type: 'mediaGroup', content: [{ type: 'media', attrs: {} }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'depois' }] }
      ]
    }
    const result = adfToMarkdown(doc)
    expect(result).toContain('(anexo)')
    const idxAntes = result.indexOf('antes')
    const idxAnexo = result.indexOf('(anexo)')
    const idxDepois = result.indexOf('depois')
    expect(idxAntes).toBeGreaterThanOrEqual(0)
    expect(idxAnexo).toBeGreaterThan(idxAntes)
    expect(idxDepois).toBeGreaterThan(idxAnexo)
  })

  it('mention inline mantém o texto da menção ("@Ana")', () => {
    const doc: AdfNode = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Olá ' },
            { type: 'mention', attrs: { text: '@Ana' } }
          ]
        }
      ]
    }
    expect(adfToMarkdown(doc)).toContain('@Ana')
  })

  it('nó desconhecido (ex. panel) não lança e preserva o texto interno', () => {
    const doc: AdfNode = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'panel',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'aviso' }] }]
        }
      ]
    }
    expect(() => adfToMarkdown(doc)).not.toThrow()
    expect(adfToMarkdown(doc)).toContain('aviso')
  })
})
