import { describe, expect, it } from 'vitest'
import { adfToText, collectMentionAccountIds, textToAdf } from './adf'
import type { AdfNode } from './types'

const doc = (content: AdfNode[]): AdfNode => ({ type: 'doc', content })

describe('adfToText', () => {
  it('parágrafos e quebras', () => {
    const text = adfToText(
      doc([
        { type: 'paragraph', content: [{ type: 'text', text: 'Primeira linha' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Segunda linha' }] }
      ])
    )
    expect(text).toBe('Primeira linha\nSegunda linha')
  })

  it('menções e emoji', () => {
    const text = adfToText(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Falei com ' },
            { type: 'mention', attrs: { text: '@Fulano' } },
            { type: 'text', text: ' hoje ' },
            { type: 'emoji', attrs: { shortName: ':tada:' } }
          ]
        }
      ])
    )
    expect(text).toBe('Falei com @Fulano hoje :tada:')
  })

  it('listas', () => {
    const text = adfToText(
      doc([
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item um' }] }]
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item dois' }] }]
            }
          ]
        }
      ])
    )
    expect(text).toBe('- item um\n- item dois')
  })

  it('bloco de código', () => {
    const text = adfToText(
      doc([{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] }])
    )
    expect(text).toContain('```\nconst x = 1\n```')
  })

  it('vazio/nulo', () => {
    expect(adfToText(null)).toBe('')
    expect(adfToText(undefined)).toBe('')
  })
})

describe('collectMentionAccountIds', () => {
  it('menção simples num parágrafo', () => {
    const ids = collectMentionAccountIds(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Oi ' },
            { type: 'mention', attrs: { id: 'acc-1', text: '@Fulano' } }
          ]
        }
      ])
    )
    expect(ids).toEqual(['acc-1'])
  })

  it('menções aninhadas em lista e citação, na ordem de aparição', () => {
    const ids = collectMentionAccountIds(
      doc([
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'mention', attrs: { id: 'acc-1', text: '@Fulano' } }]
                }
              ]
            }
          ]
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'mention', attrs: { id: 'acc-2', text: '@Beltrano' } }]
            }
          ]
        }
      ])
    )
    expect(ids).toEqual(['acc-1', 'acc-2'])
  })

  it('mesma pessoa mencionada 2x não duplica', () => {
    const ids = collectMentionAccountIds(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'acc-1', text: '@Fulano' } },
            { type: 'text', text: ' e de novo ' },
            { type: 'mention', attrs: { id: 'acc-1', text: '@Fulano' } }
          ]
        }
      ])
    )
    expect(ids).toEqual(['acc-1'])
  })

  it('doc sem menção retorna vazio', () => {
    const ids = collectMentionAccountIds(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'sem menção aqui' }] }])
    )
    expect(ids).toEqual([])
  })

  it('null/undefined retorna vazio', () => {
    expect(collectMentionAccountIds(null)).toEqual([])
    expect(collectMentionAccountIds(undefined)).toEqual([])
  })
})

describe('textToAdf', () => {
  it('string vazia ou só espaços retorna doc com content vazio', () => {
    expect(textToAdf('')).toEqual({ type: 'doc', version: 1, content: [] })
    expect(textToAdf('  \n ')).toEqual({ type: 'doc', version: 1, content: [] })
  })

  it('linha ### vira heading level 3', () => {
    expect(textToAdf('### Título')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Título' }] }
      ]
    })
  })

  it('# até ###### mapeia para level 1 a 6', () => {
    for (let level = 1; level <= 6; level++) {
      const hashes = '#'.repeat(level)
      const doc = textToAdf(`${hashes} X`)
      expect(doc.content?.[0]).toEqual({
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: 'X' }]
      })
    }
  })

  it('linhas - [ ] / - [x] consecutivas viram um único taskList com localId sequencial', () => {
    const doc = textToAdf('- [ ] a\n- [x] b')
    expect(doc.content).toEqual([
      {
        type: 'taskList',
        attrs: { localId: '1' },
        content: [
          {
            type: 'taskItem',
            attrs: { localId: '2', state: 'TODO' },
            content: [{ type: 'text', text: 'a' }]
          },
          {
            type: 'taskItem',
            attrs: { localId: '3', state: 'DONE' },
            content: [{ type: 'text', text: 'b' }]
          }
        ]
      }
    ])
  })

  it('- [X] maiúsculo também conta como DONE (case-insensitive)', () => {
    const doc = textToAdf('- [X] feito')
    const taskList = doc.content?.[0] as AdfNode
    expect(taskList.content?.[0].attrs?.state).toBe('DONE')
  })

  it('linhas - / * sem checkbox, consecutivas, viram um único bulletList', () => {
    const doc = textToAdf('- a\n* b')
    expect(doc.content).toEqual([
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

  it('linha em branco separa blocos e não gera nó próprio', () => {
    const doc = textToAdf('a\n\nb')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }
    ])
  })

  it('linhas normais consecutivas viram um único paragraph unido por hardBreak', () => {
    const doc = textToAdf('a\nb')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]
      }
    ])
  })

  it('**negrito** vira text node com mark strong, preservando o texto ao redor', () => {
    const doc = textToAdf('x **b** y')
    expect(doc.content?.[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'x ' },
        { type: 'text', text: 'b', marks: [{ type: 'strong' }] },
        { type: 'text', text: ' y' }
      ]
    })
  })

  it('texto sem ** vira um único text node sem marks', () => {
    const doc = textToAdf('sem negrito')
    expect(doc.content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'sem negrito' }]
    })
  })

  it('** sem fechamento fica literal no texto', () => {
    const doc = textToAdf('abre **mas não fecha')
    expect(doc.content?.[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'abre **mas não fecha' }]
    })
  })

  it('documento misto no formato Biud: sequência de blocos e amostras pontuais', () => {
    const text = [
      '### 🎯 Critérios de Aceite',
      '',
      '**Cenário 1: x**',
      'Dado que …',
      '',
      '- [ ] item pendente',
      '- [x] item feito'
    ].join('\n')

    const doc = textToAdf(text)

    expect(doc.type).toBe('doc')
    expect(doc.version).toBe(1)
    expect(doc.content?.map((n) => n.type)).toEqual(['heading', 'paragraph', 'taskList'])

    const heading = doc.content?.[0] as AdfNode
    expect(heading.attrs).toEqual({ level: 3 })
    expect(heading.content).toEqual([{ type: 'text', text: '🎯 Critérios de Aceite' }])

    const cenarioParagraph = doc.content?.[1] as AdfNode
    expect(cenarioParagraph.content).toEqual([
      { type: 'text', text: 'Cenário 1: x', marks: [{ type: 'strong' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'Dado que …' }
    ])

    const taskList = doc.content?.[2] as AdfNode
    expect(taskList.content?.[0].attrs?.state).toBe('TODO')
    expect(taskList.content?.[1].attrs?.state).toBe('DONE')
  })
})
