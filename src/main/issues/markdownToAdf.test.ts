import { describe, expect, it } from 'vitest'
import { markdownToAdf } from './markdownToAdf'

describe('markdownToAdf', () => {
  it('string vazia -> doc com content vazio', () => {
    expect(markdownToAdf('')).toEqual({ type: 'doc', version: 1, content: [] })
  })

  it('string só com espaços -> doc com content vazio', () => {
    expect(markdownToAdf('   ')).toEqual({ type: 'doc', version: 1, content: [] })
  })

  it('negrito **mundo** dentro de um parágrafo', () => {
    const result = markdownToAdf('Olá **mundo**')
    expect(result).toEqual({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Olá ' },
            { type: 'text', text: 'mundo', marks: [{ type: 'strong' }] }
          ]
        }
      ]
    })
  })

  it('heading nível 2', () => {
    const result = markdownToAdf('## Título')
    expect(result.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Título' }]
      }
    ])
  })

  it('itálico com * e com _ geram mark em', () => {
    for (const md of ['*it*', '_it_']) {
      const result = markdownToAdf(md)
      expect(result.content).toEqual([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'it', marks: [{ type: 'em' }] }]
        }
      ])
    }
  })

  it('code inline `x` gera mark code', () => {
    const result = markdownToAdf('`x`')
    expect(result.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }]
      }
    ])
  })

  it('~~riscado~~ gera mark strike', () => {
    const result = markdownToAdf('~~riscado~~')
    expect(result.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'riscado', marks: [{ type: 'strike' }] }]
      }
    ])
  })

  it('link [Jira](https://x.com) gera mark link com href', () => {
    const result = markdownToAdf('[Jira](https://x.com)')
    expect(result.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Jira',
            marks: [{ type: 'link', attrs: { href: 'https://x.com' } }]
          }
        ]
      }
    ])
  })

  it('lista não ordenada "- a\\n- b" vira bulletList com 2 listItem', () => {
    const result = markdownToAdf('- a\n- b')
    expect(result.content).toEqual([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }]
          }
        ]
      }
    ])
  })

  it('lista ordenada "1. um\\n2. dois" vira orderedList com 2 itens', () => {
    const result = markdownToAdf('1. um\n2. dois')
    expect(result.content).toEqual([
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'um' }] }]
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dois' }] }]
          }
        ]
      }
    ])
  })

  it('fence com linguagem: codeBlock com attrs.language e texto literal', () => {
    const result = markdownToAdf('```js\nconst x = 1\n```')
    expect(result.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [{ type: 'text', text: 'const x = 1' }]
      }
    ])
  })

  it('fence sem linguagem: codeBlock sem language em attrs', () => {
    const result = markdownToAdf('```\nconst x = 1\n```')
    const block = result.content![0] as {
      type: string
      attrs?: { language?: string }
      content: unknown
    }
    expect(block.type).toBe('codeBlock')
    expect(block.attrs?.language).toBeUndefined()
    expect(block.content).toEqual([{ type: 'text', text: 'const x = 1' }])
  })

  it('blockquote "> citação" vira blockquote com paragraph', () => {
    const result = markdownToAdf('> citação')
    expect(result.content).toEqual([
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citação' }] }]
      }
    ])
  })

  it('linha "---" sozinha vira rule', () => {
    const result = markdownToAdf('---')
    expect(result.content).toEqual([{ type: 'rule' }])
  })

  it('parágrafos separados por linha em branco viram 2 paragraphs', () => {
    const result = markdownToAdf('primeiro\n\nsegundo')
    expect(result.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'primeiro' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'segundo' }] }
    ])
  })

  it('linhas contíguas (sem linha em branco) juntam com espaço no mesmo paragraph', () => {
    const result = markdownToAdf('linha um\nlinha dois')
    expect(result.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'linha um linha dois' }] }
    ])
  })

  it('negrito não fechado ("a **b") vira texto literal e não lança', () => {
    expect(() => markdownToAdf('a **b')).not.toThrow()
    const result = markdownToAdf('a **b')
    expect(result.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a **b' }] }
    ])
  })
})
