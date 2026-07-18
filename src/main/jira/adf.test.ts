import { describe, expect, it } from 'vitest'
import { adfToText, collectMentionAccountIds } from './adf'
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
