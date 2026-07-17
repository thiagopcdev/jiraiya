import { describe, expect, it } from 'vitest'
import { isFreshAssignmentToMe } from './assignment'

const ME = 'acc-me'

describe('isFreshAssignmentToMe', () => {
  it('dispara quando passa de outra pessoa para mim', () => {
    expect(
      isFreshAssignmentToMe({
        previousAssignee: 'acc-outro',
        newAssignee: ME,
        myAccountId: ME,
        isFirstSync: false
      })
    ).toBe(true)
  })

  it('dispara para card novo (sem assignee anterior) atribuído a mim', () => {
    expect(
      isFreshAssignmentToMe({
        previousAssignee: undefined,
        newAssignee: ME,
        myAccountId: ME,
        isFirstSync: false
      })
    ).toBe(true)
  })

  it('não dispara se já era meu (idempotente entre syncs)', () => {
    expect(
      isFreshAssignmentToMe({
        previousAssignee: ME,
        newAssignee: ME,
        myAccountId: ME,
        isFirstSync: false
      })
    ).toBe(false)
  })

  it('não dispara se o novo assignee não sou eu', () => {
    expect(
      isFreshAssignmentToMe({
        previousAssignee: ME,
        newAssignee: 'acc-outro',
        myAccountId: ME,
        isFirstSync: false
      })
    ).toBe(false)
  })

  it('nunca dispara no primeiro sync (evita flood do backfill)', () => {
    expect(
      isFreshAssignmentToMe({
        previousAssignee: 'acc-outro',
        newAssignee: ME,
        myAccountId: ME,
        isFirstSync: true
      })
    ).toBe(false)
  })
})
