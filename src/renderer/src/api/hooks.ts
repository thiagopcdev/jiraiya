import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from './client'
import type { Period } from '@shared/periods'
import type { IpcRequest, IpcResponse } from '@shared/ipc-contract'

export function useAuthStatus(): UseQueryResult<IpcResponse<'auth:status'>> {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => invoke('auth:status', {})
  })
}

/** Status dos providers de IA (CLIs + OpenRouter): disponibilidade, provider ativo e modelos. */
export function useAiStatus(): UseQueryResult<IpcResponse<'ai:status'>> {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => invoke('ai:status', {})
  })
}

/** Modelos do OpenRouter para o combobox — só busca quando o provider ativo é openrouter. */
export function useOpenRouterModels(
  enabled: boolean
): UseQueryResult<IpcResponse<'ai:openrouterModels'>> {
  return useQuery({
    queryKey: ['openrouter-models'],
    queryFn: () => invoke('ai:openrouterModels', {}),
    enabled,
    retry: 0
  })
}

/**
 * Label do provider a citar num aviso de indisponibilidade: o ativo (se houver), senão o
 * provider explicitamente escolhido em Ajustes (mesmo indisponível) — só cai pra null
 * quando a preferência é 'auto' e nada está disponível (nenhum provider específico a citar).
 */
export function unavailableAiProviderLabel(
  status: IpcResponse<'ai:status'> | undefined
): string | null {
  if (!status) return null
  if (status.active) return status.active.label
  if (status.activePref === 'auto') return null
  return status.providers.find((p) => p.id === status.activePref)?.label ?? null
}

export function useSyncStatus(): UseQueryResult<IpcResponse<'sync:status'>> {
  return useQuery({
    queryKey: ['sync-status'],
    queryFn: () => invoke('sync:status', {}),
    refetchInterval: (query) => (query.state.data?.running ? 1000 : 30000)
  })
}

export function useProjects(refresh = false): UseQueryResult<IpcResponse<'projects:list'>> {
  return useQuery({
    queryKey: ['projects', refresh],
    queryFn: () => invoke('projects:list', { refresh })
  })
}

export function useIssues(
  period: Period,
  bucket?: IpcRequest<'issues:query'>['bucket']
): UseQueryResult<IpcResponse<'issues:query'>> {
  return useQuery({
    queryKey: ['issues', period, bucket],
    queryFn: () => invoke('issues:query', { period, bucket })
  })
}

export function useTimeline(
  period: Period,
  onlyMine: boolean,
  projectKey?: string
): UseQueryResult<IpcResponse<'activity:timeline'>> {
  return useQuery({
    queryKey: ['timeline', period, onlyMine, projectKey],
    queryFn: () => invoke('activity:timeline', { period, onlyMine, projectKey })
  })
}

export function useAlerts(): UseQueryResult<IpcResponse<'alerts:list'>> {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => invoke('alerts:list', {})
  })
}

export function usePrefs(): UseQueryResult<IpcResponse<'prefs:get'>> {
  return useQuery({
    queryKey: ['prefs'],
    queryFn: () => invoke('prefs:get', {})
  })
}

export function useTeam(period: Period): UseQueryResult<IpcResponse<'team:summary'>> {
  return useQuery({
    queryKey: ['team', period],
    queryFn: () => invoke('team:summary', { period })
  })
}

export function useVelocity(sprintCount?: number): UseQueryResult<IpcResponse<'team:velocity'>> {
  return useQuery({
    queryKey: ['velocity', sprintCount],
    queryFn: () => invoke('team:velocity', sprintCount ? { sprintCount } : {})
  })
}

export function useMentions(): UseQueryResult<IpcResponse<'mentions:list'>> {
  return useQuery({
    queryKey: ['mentions'],
    queryFn: () => invoke('mentions:list', {})
  })
}

export function useIssueTypes(
  projectKey: string | null,
  includeSubtasks = false
): UseQueryResult<IpcResponse<'issueTypes:list'>> {
  return useQuery({
    queryKey: ['issue-types', projectKey, includeSubtasks],
    queryFn: () => invoke('issueTypes:list', { projectKey: projectKey!, includeSubtasks }),
    enabled: !!projectKey,
    staleTime: 10 * 60_000
  })
}

export function useIssueActivity(
  key: string | null
): UseQueryResult<IpcResponse<'issues:activity'>> {
  return useQuery({
    queryKey: ['issue-activity', key],
    queryFn: () => invoke('issues:activity', { key: key! }),
    enabled: !!key
  })
}

export function useIssueSearch(query: string): UseQueryResult<IpcResponse<'issues:search'>> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['issue-search', trimmed],
    queryFn: () => invoke('issues:search', { query: trimmed }),
    enabled: trimmed.length >= 2,
    staleTime: 15_000
  })
}

export function useSprintList(limit?: number): UseQueryResult<IpcResponse<'sprint:list'>> {
  return useQuery({
    queryKey: ['sprint-list', limit],
    queryFn: () => invoke('sprint:list', limit ? { limit } : {})
  })
}

export function useBoard(
  boardJiraId?: number,
  sprintJiraId?: number
): UseQueryResult<IpcResponse<'board:view'>> {
  return useQuery({
    queryKey: ['board', boardJiraId ?? null, sprintJiraId ?? null],
    queryFn: () => invoke('board:view', { boardJiraId, sprintJiraId }),
    staleTime: 15_000
  })
}

export function useLeadTime(days?: number): UseQueryResult<IpcResponse<'stats:leadTime'>> {
  return useQuery({
    queryKey: ['lead-time', days],
    queryFn: () => invoke('stats:leadTime', days ? { days } : {})
  })
}

export function useWorklogs(
  key: string | null,
  enabled = true
): UseQueryResult<IpcResponse<'worklog:list'>> {
  return useQuery({
    queryKey: ['worklogs', key],
    queryFn: () => invoke('worklog:list', { key: key! }),
    enabled: !!key && enabled
  })
}

export function useMoveTargets(enabled = true): UseQueryResult<IpcResponse<'sprint:moveTargets'>> {
  return useQuery({
    queryKey: ['sprint-move-targets'],
    queryFn: () => invoke('sprint:moveTargets', {}),
    enabled,
    staleTime: 60_000
  })
}

export function useLinkTypes(enabled = true): UseQueryResult<IpcResponse<'issues:linkTypes'>> {
  return useQuery({
    queryKey: ['issue-link-types'],
    queryFn: () => invoke('issues:linkTypes', {}),
    enabled,
    staleTime: 5 * 60_000
  })
}

export function useEpics(): UseQueryResult<IpcResponse<'epics:overview'>> {
  return useQuery({
    queryKey: ['epics-overview'],
    queryFn: () => invoke('epics:overview', {}),
    staleTime: 30_000
  })
}

export function useGlobalSearch(query: string): UseQueryResult<IpcResponse<'search:global'>> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['global-search', trimmed],
    queryFn: () => invoke('search:global', { query: trimmed }),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
    placeholderData: (prev) => prev
  })
}

export function usePrStatus(): UseQueryResult<IpcResponse<'prs:status'>> {
  return useQuery({
    queryKey: ['prs-status'],
    queryFn: () => invoke('prs:status', {}),
    staleTime: 60_000
  })
}

export function usePrsForIssue(
  key: string | null,
  enabled = true
): UseQueryResult<IpcResponse<'prs:forIssue'>> {
  return useQuery({
    queryKey: ['prs-for-issue', key],
    queryFn: () => invoke('prs:forIssue', { key: key! }),
    enabled: !!key && enabled,
    staleTime: 5 * 60_000
  })
}

export function useTrends(sprintCount?: number): UseQueryResult<IpcResponse<'team:trends'>> {
  return useQuery({
    queryKey: ['team-trends', sprintCount],
    queryFn: () => invoke('team:trends', sprintCount ? { sprintCount } : {}),
    staleTime: 60_000
  })
}

/** Assina os canais push uma única vez e invalida os caches relevantes. */
export function usePushInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offProgress = window.api.on('push:sync-progress', () => {
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] })
    })
    const offComplete = window.api.on('push:sync-complete', () => {
      void queryClient.invalidateQueries()
    })
    const offAlerts = window.api.on('push:alerts-updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
    })
    const offMentions = window.api.on('push:mentions-updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['mentions'] })
    })
    const offAuth = window.api.on('push:auth-invalid', () => {
      void queryClient.invalidateQueries({ queryKey: ['auth'] })
    })
    return () => {
      offProgress()
      offComplete()
      offAlerts()
      offMentions()
      offAuth()
    }
  }, [queryClient])
}
