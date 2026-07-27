import { describe, expect, it } from 'vitest'
import { parseQuickAction } from './quickActions'

describe('parseQuickAction', () => {
  describe('mover', () => {
    it('mover BT-806 em andamento → move com statusQuery', () => {
      expect(parseQuickAction('mover BT-806 em andamento')).toEqual({
        kind: 'move',
        key: 'BT-806',
        statusQuery: 'em andamento'
      })
    })

    it('MOVER bt-806 Done → verbo case-insensitive, key normalizada para BT-806', () => {
      expect(parseQuickAction('MOVER bt-806 Done')).toEqual({
        kind: 'move',
        key: 'BT-806',
        statusQuery: 'Done'
      })
    })

    it('mover BT-806 (sem resto) → null', () => {
      expect(parseQuickAction('mover BT-806')).toBeNull()
    })

    it('mover xyz done (key inválida) → null', () => {
      expect(parseQuickAction('mover xyz done')).toBeNull()
    })

    it('espaços múltiplos são tolerados', () => {
      expect(parseQuickAction('mover  BT-1   done')).toEqual({
        kind: 'move',
        key: 'BT-1',
        statusQuery: 'done'
      })
    })
  })

  describe('atribuir', () => {
    it('atribuir BT-12 mim → assign com toMe true', () => {
      expect(parseQuickAction('atribuir BT-12 mim')).toEqual({
        kind: 'assign',
        key: 'BT-12',
        assigneeQuery: 'mim',
        toMe: true
      })
    })

    it.each(['para mim', 'a mim', 'eu', 'me'])('variação "%s" → toMe true', (query) => {
      const result = parseQuickAction(`atribuir BT-12 ${query}`)
      expect(result).toMatchObject({ kind: 'assign', key: 'BT-12', toMe: true })
    })

    it('atribuir BT-12 Wanderson → toMe false', () => {
      expect(parseQuickAction('atribuir BT-12 Wanderson')).toEqual({
        kind: 'assign',
        key: 'BT-12',
        assigneeQuery: 'Wanderson',
        toMe: false
      })
    })
  })

  describe('apontar', () => {
    it('apontar 1h30m BT-3 → worklog com timeSpent "1h 30m" e comment null', () => {
      expect(parseQuickAction('apontar 1h30m BT-3')).toEqual({
        kind: 'worklog',
        key: 'BT-3',
        timeSpent: '1h 30m',
        comment: null
      })
    })

    it('apontar 45m BT-3 revisão de código → comment preenchido', () => {
      expect(parseQuickAction('apontar 45m BT-3 revisão de código')).toEqual({
        kind: 'worklog',
        key: 'BT-3',
        timeSpent: '45m',
        comment: 'revisão de código'
      })
    })

    it('apontar 2h BT-3 → timeSpent "2h"', () => {
      expect(parseQuickAction('apontar 2h BT-3')).toEqual({
        kind: 'worklog',
        key: 'BT-3',
        timeSpent: '2h',
        comment: null
      })
    })

    it('apontar xh BT-3 (tempo inválido) → null', () => {
      expect(parseQuickAction('apontar xh BT-3')).toBeNull()
    })

    it('apontar 1h30m SEMKEY (key inválida) → null', () => {
      expect(parseQuickAction('apontar 1h30m SEMKEY')).toBeNull()
    })
  })

  describe('comentar', () => {
    it('comentar BT-9 subiu para homolog → comment com body', () => {
      expect(parseQuickAction('comentar BT-9 subiu para homolog')).toEqual({
        kind: 'comment',
        key: 'BT-9',
        body: 'subiu para homolog'
      })
    })

    it('comentar BT-9 (sem corpo) → null', () => {
      expect(parseQuickAction('comentar BT-9')).toBeNull()
    })
  })

  describe('entradas que não são quick actions', () => {
    it('criar nova ideia → null', () => {
      expect(parseQuickAction('criar nova ideia')).toBeNull()
    })

    it('qualquer busca normal → null', () => {
      expect(parseQuickAction('qualquer busca normal')).toBeNull()
    })

    it('string vazia → null', () => {
      expect(parseQuickAction('')).toBeNull()
    })

    it('string só de espaços → null', () => {
      expect(parseQuickAction('   ')).toBeNull()
    })
  })
})
