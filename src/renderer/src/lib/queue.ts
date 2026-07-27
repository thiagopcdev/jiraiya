import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '../api/client'
import type { PendingAction } from '@shared/domain'

/** Fila de ações offline (transições, atribuições, worklogs, comentários enfileirados
 * enquanto sem rede). Consumido pelo badge da sidebar e pelo QueueCenter. */
export function useQueue(): {
  actions: PendingAction[]
  pendingCount: number
  failedCount: number
} {
  const queryClient = useQueryClient()

  useEffect(() => {
    const off = window.api.on('push:queue-changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['queue'] })
    })
    return () => off()
  }, [queryClient])

  const { data } = useQuery({
    queryKey: ['queue'],
    queryFn: () => invoke('queue:list', {})
  })

  const actions = data?.actions ?? []
  const pendingCount = actions.filter(
    (a) => a.status === 'pending' || a.status === 'inflight'
  ).length
  const failedCount = actions.filter((a) => a.status === 'failed').length

  return { actions, pendingCount, failedCount }
}
