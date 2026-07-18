import { describe, expect, it } from 'vitest'
import { extractMentions } from './mentions'
import type { AdfNode, JiraComment } from '../jira/types'

const ME = 'acc-me'
const OUTRA = 'acc-outra'
const iso = (d: string): string => new Date(d).toISOString()

function mentionNode(accountId: string, text = '@Alguém'): AdfNode {
  return { type: 'mention', attrs: { id: accountId, text } }
}

function textNode(text: string): AdfNode {
  return { type: 'text', text }
}

function bodyDoc(...content: AdfNode[]): AdfNode {
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

function comment(id: string, over: Partial<JiraComment> = {}): JiraComment {
  return {
    id,
    author: { accountId: OUTRA, displayName: 'Outra Pessoa' },
    body: bodyDoc(textNode('oi ')),
    created: iso('2026-07-15T10:00:00Z'),
    ...over
  }
}

describe('extractMentions', () => {
  it('comentário mencionando myAccountId vira 1 MentionInsert', () => {
    const c = comment('101', {
      body: bodyDoc(textNode('Oi '), mentionNode(ME, '@Eu')),
      created: iso('2026-07-16T08:30:00Z')
    })
    const result = extractMentions({ issueKey: 'BT-1', comments: [c], myAccountId: ME })
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      issueKey: 'BT-1',
      sourceId: 'comment:101',
      authorAccountId: OUTRA,
      authorName: 'Outra Pessoa',
      excerpt: 'Oi @Eu',
      occurredAt: iso('2026-07-16T08:30:00Z')
    })
  })

  it('comentário mencionando outra pessoa não entra', () => {
    const c = comment('102', {
      body: bodyDoc(textNode('Oi '), mentionNode('acc-terceiro', '@Terceiro'))
    })
    const result = extractMentions({ issueKey: 'BT-1', comments: [c], myAccountId: ME })
    expect(result).toEqual([])
  })

  it('comentário sem body não entra e não explode', () => {
    const c = comment('103', { body: undefined })
    const result = extractMentions({ issueKey: 'BT-1', comments: [c], myAccountId: ME })
    expect(result).toEqual([])
  })

  it('auto-menção (autor sou eu, mencionando a mim) entra', () => {
    const c = comment('104', {
      author: { accountId: ME, displayName: 'Eu' },
      body: bodyDoc(mentionNode(ME, '@Eu'), textNode(' registrando'))
    })
    const result = extractMentions({ issueKey: 'BT-1', comments: [c], myAccountId: ME })
    expect(result).toHaveLength(1)
    expect(result[0].authorAccountId).toBe(ME)
  })

  it('excerpt trunca texto longo em até 281 chars terminando com "…"', () => {
    const longText = 'a'.repeat(400)
    const c = comment('105', {
      body: bodyDoc(mentionNode(ME, '@Eu'), textNode(longText))
    })
    const result = extractMentions({ issueKey: 'BT-1', comments: [c], myAccountId: ME })
    expect(result).toHaveLength(1)
    const excerpt = result[0].excerpt as string
    expect(excerpt.length).toBeLessThanOrEqual(281)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('múltiplos comentários misturados: só os que me mencionam, na ordem dada', () => {
    const c1 = comment('1', {
      body: bodyDoc(mentionNode(ME, '@Eu')),
      created: iso('2026-07-14T09:00:00Z')
    })
    const c2 = comment('2', {
      body: bodyDoc(mentionNode('acc-terceiro', '@Terceiro')),
      created: iso('2026-07-14T10:00:00Z')
    })
    const c3 = comment('3', {
      body: bodyDoc(mentionNode(ME, '@Eu')),
      created: iso('2026-07-14T11:00:00Z')
    })
    const c4 = comment('4', { body: undefined, created: iso('2026-07-14T12:00:00Z') })
    const result = extractMentions({
      issueKey: 'BT-1',
      comments: [c1, c2, c3, c4],
      myAccountId: ME
    })
    expect(result.map((m) => m.sourceId)).toEqual(['comment:1', 'comment:3'])
  })
})
