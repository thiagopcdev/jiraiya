import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from './client'
import type { Period } from '@shared/periods'
import type { IpcResponse } from '@shared/ipc-contract'

export function useAuthStatus(): UseQueryResult<IpcResponse<'auth:status'>> {
  return useQuery({
    queryKey: ['auth'],
    queryFn: () => invoke('auth:status', {})
  })
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
  bucket?: 'moved' | 'commented' | 'done' | 'inProgress' | 'stalled' | 'all'
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
    const offAuth = window.api.on('push:auth-invalid', () => {
      void queryClient.invalidateQueries({ queryKey: ['auth'] })
    })
    return () => {
      offProgress()
      offComplete()
      offAlerts()
      offAuth()
    }
  }, [queryClient])
}
