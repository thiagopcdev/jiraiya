// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { invoke } from '../api/client'
import { installMockApi } from './mockApi'
import { renderWithProviders } from './render'

/** Auto-teste do harness: mockApi + providers + jsdom + jest-dom funcionando juntos. */

function Probe(): React.JSX.Element {
  const { data, error } = useQuery({
    queryKey: ['probe'],
    queryFn: () => invoke('prefs:get', {})
  })
  if (error) return <p>erro: {error.message}</p>
  return <p>{data ? `tema ${data.theme}` : 'carregando'}</p>
}

describe('harness de testes de componente', () => {
  it('renderiza com providers e resolve canal mockado', async () => {
    const api = installMockApi()
    api.set('prefs:get', () => ({ theme: 'dark' }) as never)
    renderWithProviders(<Probe />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('tema dark')).toBeInTheDocument())
    expect(api.count('prefs:get')).toBe(1)
  })

  it('canal não mockado vira erro visível (IpcError NO_MOCK)', async () => {
    installMockApi()
    renderWithProviders(<Probe />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText(/canal não mockado: prefs:get/)).toBeInTheDocument()
    )
  })
})
