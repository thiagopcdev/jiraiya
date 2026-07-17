/**
 * Detecta atribuição nova para mim entre dois syncs (puro, testável).
 * Nunca dispara no primeiro sync (backfill) — senão notificaria tudo que já
 * está atribuído a mim de uma vez. `previousAssignee` undefined = card novo.
 */
export function isFreshAssignmentToMe(params: {
  previousAssignee: string | null | undefined
  newAssignee: string | null
  myAccountId: string
  isFirstSync: boolean
}): boolean {
  if (params.isFirstSync) return false
  return params.previousAssignee !== params.myAccountId && params.newAssignee === params.myAccountId
}
