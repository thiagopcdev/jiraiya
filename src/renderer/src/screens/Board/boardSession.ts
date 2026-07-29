/**
 * Board escolhido nesta sessão: montagens seguintes do Quadro já pedem o id
 * certo em vez da chave "sem board" — que o cache do React Query serviria com
 * o board de antes da troca. Entre sessões, quem lembra é o main (pref
 * lastBoardJiraId, resolvido pelo board:view quando nenhum board é pedido).
 */
let sessionBoardId: number | undefined

export function getSessionBoardId(): number | undefined {
  return sessionBoardId
}

export function setSessionBoardId(id: number | undefined): void {
  sessionBoardId = id
}
