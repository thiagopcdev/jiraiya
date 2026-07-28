// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, loadDraft, saveDraft } from './drafts'

describe('lib/drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loadDraft retorna null quando não há rascunho salvo', () => {
    expect(loadDraft('BT-1')).toBeNull()
  })

  it('saveDraft grava e loadDraft recupera o texto', () => {
    saveDraft('BT-1', 'texto do comentário')
    expect(loadDraft('BT-1')).toBe('texto do comentário')
  })

  it('rascunhos são isolados por issueKey', () => {
    saveDraft('BT-1', 'rascunho 1')
    saveDraft('BT-2', 'rascunho 2')
    expect(loadDraft('BT-1')).toBe('rascunho 1')
    expect(loadDraft('BT-2')).toBe('rascunho 2')
  })

  it('saveDraft com texto vazio ou só espaços remove a chave em vez de gravar', () => {
    saveDraft('BT-1', 'algo')
    saveDraft('BT-1', '   ')
    expect(loadDraft('BT-1')).toBeNull()
    expect(localStorage.getItem('jiraiya.draft.comment.BT-1')).toBeNull()
  })

  it('clearDraft remove o rascunho salvo', () => {
    saveDraft('BT-1', 'algo')
    clearDraft('BT-1')
    expect(loadDraft('BT-1')).toBeNull()
  })

  it('loadDraft trata string vazia salva diretamente como ausência de rascunho', () => {
    localStorage.setItem('jiraiya.draft.comment.BT-1', '   ')
    expect(loadDraft('BT-1')).toBeNull()
  })

  describe('degradação sem localStorage', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('saveDraft não lança quando localStorage.setItem falha', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('indisponível')
      })
      expect(() => saveDraft('BT-1', 'texto')).not.toThrow()
    })

    it('loadDraft retorna null quando localStorage.getItem falha', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('indisponível')
      })
      expect(loadDraft('BT-1')).toBeNull()
    })

    it('clearDraft não lança quando localStorage.removeItem falha', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('indisponível')
      })
      expect(() => clearDraft('BT-1')).not.toThrow()
    })
  })
})
