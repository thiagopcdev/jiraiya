import { createContext, useContext } from 'react'

/**
 * Contexto global da gaveta de detalhe de card. O provider vive em
 * IssueDetail.tsx (montado no App); qualquer tela abre um card com
 * useIssueDetail().openIssue(key).
 */
export interface IssueDetailApi {
  openIssue: (key: string) => void
  close: () => void
}

export const IssueDetailContext = createContext<IssueDetailApi>({
  openIssue: () => {},
  close: () => {}
})

export function useIssueDetail(): IssueDetailApi {
  return useContext(IssueDetailContext)
}
