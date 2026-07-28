import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { IssueDetailProvider } from '../components/IssueDetailProvider'

/**
 * Render com os providers reais do app (QueryClient sem retry + MemoryRouter
 * + IssueDetailProvider). Instale o mockApi ANTES de chamar.
 */

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } }
  })
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; withIssueDetail?: boolean; client?: QueryClient } = {}
): RenderResult & { client: QueryClient } {
  const client = opts.client ?? makeQueryClient()
  const inner = (children: ReactNode): ReactNode =>
    opts.withIssueDetail === false ? (
      children
    ) : (
      <IssueDetailProvider>{children}</IssueDetailProvider>
    )

  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>{inner(ui)}</MemoryRouter>
    </QueryClientProvider>
  )
  return Object.assign(result, { client })
}
