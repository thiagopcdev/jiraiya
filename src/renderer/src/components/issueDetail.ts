import { createContext, useContext, useMemo, type JSX } from 'react'

/**
 * Contexto global da gaveta de detalhe de card. O provider vive em
 * IssueDetail.tsx (montado no App); qualquer tela abre um card com
 * useIssueDetail().openIssue(key).
 */
export interface IssueDetailApi {
  openIssue: (key: string) => void
  close: () => void
  /**
   * Monta o card aberto in-flow (painel docado). Enquanto algum DockedPanel
   * estiver montado, o provider NÃO renderiza o overlay. Devolve null quando
   * não há card aberto. Só o Quadro usa.
   */
  DockedPanel: () => JSX.Element | null
}

/** `DockedPanel` devolve null quando não há painel docado — o caso de quase todo mundo. */
const noopDockedPanel = (): JSX.Element | null => null

/**
 * Valor aceito pelo Provider. `DockedPanel` é opcional aqui (e só aqui): quem
 * stuba o contexto — dezenas de testes de tela — só se importa com
 * abrir/fechar. Para quem CONSOME, `useIssueDetail()` sempre entrega a API
 * completa, com o no-op no lugar do que faltar.
 */
export type IssueDetailContextValue = Omit<IssueDetailApi, 'DockedPanel'> &
  Partial<Pick<IssueDetailApi, 'DockedPanel'>>

export const IssueDetailContext = createContext<IssueDetailContextValue>({
  openIssue: () => {},
  close: () => {},
  DockedPanel: noopDockedPanel
})

export function useIssueDetail(): IssueDetailApi {
  const ctx = useContext(IssueDetailContext)
  // memo: `DockedPanel` é montado como componente, então a referência precisa
  // ser estável entre renders — senão o painel remonta e perde o estado do card
  return useMemo(() => ({ ...ctx, DockedPanel: ctx.DockedPanel ?? noopDockedPanel }), [ctx])
}

/**
 * Largura do painel docado. O painel encosta na borda direita, então o
 * divisor fica à esquerda: arrastar para a esquerda alarga. Persistida em
 * localStorage porque é preferência de layout puramente local — não vale um
 * round-trip de IPC nem uma coluna em prefs.
 */
export const DETAIL_PANEL_WIDTH_KEY = 'jiraiya.detailPanelWidth'
export const DETAIL_PANEL_WIDTH_DEFAULT = 380
export const DETAIL_PANEL_WIDTH_MIN = 320
export const DETAIL_PANEL_WIDTH_MAX = 700

/** Largura válida do painel: inteiro dentro de [320, 700]; lixo vira o default. */
export function clampDetailPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DETAIL_PANEL_WIDTH_DEFAULT
  return Math.min(DETAIL_PANEL_WIDTH_MAX, Math.max(DETAIL_PANEL_WIDTH_MIN, Math.round(width)))
}

export function loadDetailPanelWidth(): number {
  try {
    const raw = localStorage.getItem(DETAIL_PANEL_WIDTH_KEY)
    if (raw === null || raw.trim() === '') return DETAIL_PANEL_WIDTH_DEFAULT
    return clampDetailPanelWidth(Number(raw))
  } catch {
    return DETAIL_PANEL_WIDTH_DEFAULT
  }
}

export function saveDetailPanelWidth(width: number): void {
  try {
    localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(clampDetailPanelWidth(width)))
  } catch {
    // localStorage indisponível (ex.: modo privado) — a largura só não persiste
  }
}

/**
 * Abaixo desta largura de janela o painel docado não vale a pena (handoff
 * regra 2): o Quadro volta a abrir o card sobreposto.
 */
export const DETAIL_DOCK_MIN_WINDOW_QUERY = '(min-width: 1100px)'
