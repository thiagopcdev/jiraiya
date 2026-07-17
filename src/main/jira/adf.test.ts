import { describe, expect, it } from 'vitest'
import { adfToText } from './adf'
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
