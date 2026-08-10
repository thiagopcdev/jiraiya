// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { installMockApi } from '../testing/mockApi'
import { makeQueryClient } from '../testing/render'
import {
  unavailableAiProviderLabel,
  useAiStatus,
  useAlerts,
  useAuthStatus,
  useBoard,
  useEpics,
  useGlobalSearch,
  useIssueActivity,
  useIssueSearch,
  useIssueTypes,
  useIssues,
  useLeadTime,
  useLinkTypes,
  useMentions,
  useMoveTargets,
  useOpenRouterModels,
  usePrStatus,
  usePrefs,
  usePrsForIssue,
  useProjects,
  usePushInvalidation,
  useSprintList,
  useSyncStatus,
  useTeam,
  useTimeline,
  useTrends,
  useVelocity,
  useWorklogs
} from './hooks'
import type { IpcResponse } from '@shared/ipc-contract'

function wrapper(
  client = makeQueryClient()
): (props: { children: ReactNode }) => React.JSX.Element {
  function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

/** Roda um hook de query até resolver (sucesso ou erro) e devolve o resultado final. */
async function runQuery<T>(useHook: () => UseQueryResult<T>): Promise<UseQueryResult<T>> {
  const { result } = renderHook(useHook, { wrapper: wrapper() })
  await waitFor(() => expect(result.current.isPending).toBe(false))
  return result.current
}

describe('api/hooks — hooks simples (sem args ou com args fixos)', () => {
  it('useAuthStatus chama auth:status', async () => {
    const api = installMockApi({
      'auth:status': () => ({ connected: true, workspace: null })
    })
    const res = await runQuery(() => useAuthStatus())
    expect(res.data).toEqual({ connected: true, workspace: null })
    expect(api.count('auth:status')).toBe(1)
  })

  it('useAiStatus chama ai:status', async () => {
    installMockApi({
      'ai:status': () => ({ providers: [], active: null, activePref: 'auto' })
    })
    const res = await runQuery(() => useAiStatus())
    expect(res.data?.activePref).toBe('auto')
  })

  it('useSyncStatus chama sync:status', async () => {
    installMockApi({
      'sync:status': () => ({
        running: false,
        lastSuccessAt: null,
        lastError: null,
        progress: null
      })
    })
    const res = await runQuery(() => useSyncStatus())
    expect(res.data?.running).toBe(false)
  })

  it('useProjects chama projects:list com refresh no payload', async () => {
    const api = installMockApi({ 'projects:list': () => ({ projects: [] }) })
    await runQuery(() => useProjects(true))
    expect(api.lastPayload('projects:list')).toEqual({ refresh: true })
  })

  it('useIssues chama issues:query com period e bucket', async () => {
    const api = installMockApi({ 'issues:query': () => ({ issues: [] }) })
    await runQuery(() => useIssues({ type: '7d' }, 'done'))
    expect(api.lastPayload('issues:query')).toEqual({ period: { type: '7d' }, bucket: 'done' })
  })

  it('useTimeline chama activity:timeline com onlyMine e projectKey', async () => {
    const api = installMockApi({ 'activity:timeline': () => ({ activities: [] }) })
    await runQuery(() => useTimeline({ type: 'today' }, false, 'BT'))
    expect(api.lastPayload('activity:timeline')).toEqual({
      period: { type: 'today' },
      onlyMine: false,
      projectKey: 'BT'
    })
  })

  it('useAlerts chama alerts:list', async () => {
    installMockApi({ 'alerts:list': () => ({ alerts: [] }) })
    const res = await runQuery(() => useAlerts())
    expect(res.data).toEqual({ alerts: [] })
  })

  it('usePrefs chama prefs:get', async () => {
    installMockApi({ 'prefs:get': () => ({ theme: 'dark' }) as never })
    const res = await runQuery(() => usePrefs())
    expect((res.data as { theme: string } | undefined)?.theme).toBe('dark')
  })

  it('useTeam chama team:summary com o period', async () => {
    const api = installMockApi({
      'team:summary': () => ({ members: [], periodLabel: '7 dias', syncMode: 'project' })
    })
    await runQuery(() => useTeam({ type: '7d' }))
    expect(api.lastPayload('team:summary')).toEqual({ period: { type: '7d' } })
  })

  it('useVelocity omite sprintCount do payload quando não informado', async () => {
    const api = installMockApi({
      'team:velocity': () => ({
        sprints: [],
        totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 }
      })
    })
    await runQuery(() => useVelocity())
    expect(api.lastPayload('team:velocity')).toEqual({})
  })

  it('useVelocity inclui sprintCount quando informado', async () => {
    const api = installMockApi({
      'team:velocity': () => ({
        sprints: [],
        totals: { myPoints: 0, teamPoints: 0, myCount: 0, teamCount: 0 }
      })
    })
    await runQuery(() => useVelocity(5))
    expect(api.lastPayload('team:velocity')).toEqual({ sprintCount: 5 })
  })

  it('useMentions chama mentions:list', async () => {
    installMockApi({ 'mentions:list': () => ({ mentions: [], unreadCount: 0 }) })
    const res = await runQuery(() => useMentions())
    expect(res.data?.unreadCount).toBe(0)
  })

  it('useSprintList chama sprint:list', async () => {
    installMockApi({ 'sprint:list': () => ({ sprints: [] }) })
    const res = await runQuery(() => useSprintList())
    expect(res.data).toEqual({ sprints: [] })
  })

  it('useBoard monta a queryKey com boardJiraId/sprintJiraId e usa null quando ausentes', async () => {
    const api = installMockApi({
      'board:view': () => ({
        board: { jiraId: 1, name: 'B', type: 'scrum', projectKey: 'BT' },
        boards: [],
        sprint: null,
        sprints: [],
        readOnly: false,
        columns: [],
        unmapped: [],
        columnsSource: 'jira'
      })
    })
    await runQuery(() => useBoard())
    expect(api.lastPayload('board:view')).toEqual({
      boardJiraId: undefined,
      sprintJiraId: undefined
    })
  })

  it('useLeadTime chama stats:leadTime', async () => {
    installMockApi({
      'stats:leadTime': () => ({ statuses: [], cardCount: 0, windowDays: 30 })
    })
    const res = await runQuery(() => useLeadTime())
    expect(res.data?.windowDays).toBe(30)
  })

  it('useEpics chama epics:overview', async () => {
    installMockApi({ 'epics:overview': () => ({ epics: [] }) })
    const res = await runQuery(() => useEpics())
    expect(res.data).toEqual({ epics: [] })
  })

  it('usePrStatus chama prs:status', async () => {
    installMockApi({ 'prs:status': () => ({ ghAvailable: true, enabled: false }) })
    const res = await runQuery(() => usePrStatus())
    expect(res.data?.ghAvailable).toBe(true)
  })

  it('useTrends chama team:trends', async () => {
    installMockApi({ 'team:trends': () => ({ sprints: [] }) })
    const res = await runQuery(() => useTrends())
    expect(res.data).toEqual({ sprints: [] })
  })
})

describe('api/hooks — hooks com enabled condicional', () => {
  it('useIssueTypes não chama o canal quando projectKey é null', async () => {
    const api = installMockApi({ 'issueTypes:list': () => ({ issueTypes: [] }) })
    const { result } = renderHook(() => useIssueTypes(null), { wrapper: wrapper() })
    expect(result.current.fetchStatus).toBe('idle')
    expect(api.count('issueTypes:list')).toBe(0)
  })

  it('useIssueTypes chama issueTypes:list quando há projectKey', async () => {
    const api = installMockApi({ 'issueTypes:list': () => ({ issueTypes: [] }) })
    await runQuery(() => useIssueTypes('BT', true))
    expect(api.lastPayload('issueTypes:list')).toEqual({ projectKey: 'BT', includeSubtasks: true })
  })

  it('useIssueActivity não chama o canal quando key é null', () => {
    const api = installMockApi({ 'issues:activity': () => ({ activities: [] }) })
    renderHook(() => useIssueActivity(null), { wrapper: wrapper() })
    expect(api.count('issues:activity')).toBe(0)
  })

  it('useIssueActivity chama o canal quando há key', async () => {
    const api = installMockApi({ 'issues:activity': () => ({ activities: [] }) })
    await runQuery(() => useIssueActivity('BT-1'))
    expect(api.lastPayload('issues:activity')).toEqual({ key: 'BT-1' })
  })

  it('useIssueSearch só habilita com 2+ caracteres', () => {
    const api = installMockApi({ 'issues:search': () => ({ issues: [] }) })
    renderHook(() => useIssueSearch('a'), { wrapper: wrapper() })
    expect(api.count('issues:search')).toBe(0)
  })

  it('useIssueSearch habilita e usa a query trimada', async () => {
    const api = installMockApi({ 'issues:search': () => ({ issues: [] }) })
    await runQuery(() => useIssueSearch('  abc  '))
    expect(api.lastPayload('issues:search')).toEqual({ query: 'abc' })
  })

  it('useGlobalSearch só habilita com 2+ caracteres (trimado)', () => {
    const api = installMockApi({ 'search:global': () => ({ results: [] }) })
    renderHook(() => useGlobalSearch(' a '), { wrapper: wrapper() })
    expect(api.count('search:global')).toBe(0)
  })

  it('useWorklogs não chama o canal com key null', () => {
    const api = installMockApi({ 'worklog:list': () => ({ worklogs: [], totalTimeSpent: null }) })
    renderHook(() => useWorklogs(null), { wrapper: wrapper() })
    expect(api.count('worklog:list')).toBe(0)
  })

  it('useWorklogs respeita o enabled explícito mesmo com key', () => {
    const api = installMockApi({ 'worklog:list': () => ({ worklogs: [], totalTimeSpent: null }) })
    renderHook(() => useWorklogs('BT-1', false), { wrapper: wrapper() })
    expect(api.count('worklog:list')).toBe(0)
  })

  it('useMoveTargets respeita enabled=false', () => {
    const api = installMockApi({ 'sprint:moveTargets': () => ({ sprints: [] }) })
    renderHook(() => useMoveTargets(false), { wrapper: wrapper() })
    expect(api.count('sprint:moveTargets')).toBe(0)
  })

  it('useLinkTypes respeita enabled=false', () => {
    const api = installMockApi({ 'issues:linkTypes': () => ({ types: [] }) })
    renderHook(() => useLinkTypes(false), { wrapper: wrapper() })
    expect(api.count('issues:linkTypes')).toBe(0)
  })

  it('usePrsForIssue não chama com key null', () => {
    const api = installMockApi({ 'prs:forIssue': () => ({ available: true, prs: [] }) })
    renderHook(() => usePrsForIssue(null), { wrapper: wrapper() })
    expect(api.count('prs:forIssue')).toBe(0)
  })

  it('usePrsForIssue chama com key presente', async () => {
    const api = installMockApi({ 'prs:forIssue': () => ({ available: true, prs: [] }) })
    await runQuery(() => usePrsForIssue('BT-1'))
    expect(api.lastPayload('prs:forIssue')).toEqual({ key: 'BT-1' })
  })

  it('useOpenRouterModels respeita enabled=false', () => {
    const api = installMockApi({ 'ai:openrouterModels': () => ({ models: [] }) })
    renderHook(() => useOpenRouterModels(false), { wrapper: wrapper() })
    expect(api.count('ai:openrouterModels')).toBe(0)
  })

  it('useOpenRouterModels chama quando enabled=true', async () => {
    const api = installMockApi({ 'ai:openrouterModels': () => ({ models: [] }) })
    await runQuery(() => useOpenRouterModels(true))
    expect(api.count('ai:openrouterModels')).toBe(1)
  })
})

describe('unavailableAiProviderLabel', () => {
  it('undefined quando o status ainda não carregou', () => {
    expect(unavailableAiProviderLabel(undefined)).toBeNull()
  })

  it('label do provider ativo quando há um', () => {
    const status: IpcResponse<'ai:status'> = {
      providers: [],
      active: { id: 'claude', label: 'Claude' },
      activePref: 'auto'
    }
    expect(unavailableAiProviderLabel(status)).toBe('Claude')
  })

  it('null quando pref é "auto" e nada está disponível', () => {
    const status: IpcResponse<'ai:status'> = { providers: [], active: null, activePref: 'auto' }
    expect(unavailableAiProviderLabel(status)).toBeNull()
  })

  it('label do provider explicitamente escolhido (mesmo indisponível)', () => {
    const status: IpcResponse<'ai:status'> = {
      providers: [
        {
          id: 'gemini',
          label: 'Gemini',
          kind: 'cli',
          available: false,
          detail: null,
          models: []
        }
      ],
      active: null,
      activePref: 'gemini'
    }
    expect(unavailableAiProviderLabel(status)).toBe('Gemini')
  })
})

describe('usePushInvalidation', () => {
  it('invalida o cache de alertas ao receber push:alerts-updated', async () => {
    const api = installMockApi({ 'alerts:list': () => ({ alerts: [] }) })
    const client = makeQueryClient()
    const { result } = renderHook(() => useAlerts(), { wrapper: wrapper(client) })
    renderHook(() => usePushInvalidation(), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.count('alerts:list')).toBe(1)

    act(() => {
      api.push('push:alerts-updated', { count: 3 })
    })

    await waitFor(() => expect(api.count('alerts:list')).toBe(2))
  })

  it('recarrega tudo ao receber push:issue-gone (card excluído saiu do cache)', async () => {
    const api = installMockApi({ 'alerts:list': () => ({ alerts: [] }) })
    const client = makeQueryClient()
    const { result } = renderHook(() => useAlerts(), { wrapper: wrapper(client) })
    renderHook(() => usePushInvalidation(), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    act(() => {
      api.push('push:issue-gone', { key: 'BT-907' })
    })

    await waitFor(() => expect(api.count('alerts:list')).toBe(2))
  })

  it('invalida o cache de auth ao receber push:auth-invalid', async () => {
    const api = installMockApi({
      'auth:status': () => ({ connected: true, workspace: null })
    })
    const client = makeQueryClient()
    const { result } = renderHook(() => useAuthStatus(), { wrapper: wrapper(client) })
    renderHook(() => usePushInvalidation(), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    act(() => {
      api.push('push:auth-invalid', {})
    })

    await waitFor(() => expect(api.count('auth:status')).toBe(2))
  })
})
