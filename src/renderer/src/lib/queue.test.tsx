// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { PendingAction } from '@shared/domain'
import { installMockApi } from '../testing/mockApi'
import { makeQueryClient } from '../testing/render'
import { useQueue } from './queue'

function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 1,
    issueKey: 'BT-1',
    type: 'comment',
    summary: 'Comentar: "oi"',
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('useQueue', () => {
  it('calcula pendingCount (pending + inflight) e failedCount separadamente', async () => {
    installMockApi({
      'queue:list': () => ({
        actions: [
          makeAction({ id: 1, status: 'pending' }),
          makeAction({ id: 2, status: 'inflight' }),
          makeAction({ id: 3, status: 'failed' })
        ]
      })
    })
    const client = makeQueryClient()
    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useQueue(), { wrapper })

    await waitFor(() => expect(result.current.actions).toHaveLength(3))
    expect(result.current.pendingCount).toBe(2)
    expect(result.current.failedCount).toBe(1)
  })

  it('lista vazia quando não há ações', async () => {
    installMockApi({ 'queue:list': () => ({ actions: [] }) })
    const client = makeQueryClient()
    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useQueue(), { wrapper })

    await waitFor(() => expect(result.current.actions).toEqual([]))
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.failedCount).toBe(0)
  })

  it('push:queue-changed invalida o cache e recarrega a fila', async () => {
    const api = installMockApi({ 'queue:list': () => ({ actions: [] }) })
    const client = makeQueryClient()
    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useQueue(), { wrapper })
    await waitFor(() => expect(api.count('queue:list')).toBe(1))

    api.set('queue:list', () => ({ actions: [makeAction()] }))
    act(() => {
      api.push('push:queue-changed', { pending: 1, failed: 0 })
    })

    await waitFor(() => expect(result.current.actions).toHaveLength(1))
    expect(api.count('queue:list')).toBeGreaterThanOrEqual(2)
  })
})
