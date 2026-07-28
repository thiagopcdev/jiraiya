// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, MockIpcFailure } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import UpdateBanner from './UpdateBanner'

afterEach(cleanup)

describe('UpdateBanner', () => {
  it('sem push, nada é renderizado', () => {
    installMockApi()
    const { container } = renderWithProviders(<UpdateBanner />, { withIssueDetail: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('na rota /tray nunca aparece, mesmo com update disponível', () => {
    const api = installMockApi()
    const { container } = renderWithProviders(<UpdateBanner />, {
      withIssueDetail: false,
      route: '/tray'
    })
    api.push('push:update-available', { version: '1.2.3', url: 'https://x/release' })
    expect(container).toBeEmptyDOMElement()
  })

  it('push:update-available mostra a versão e permite baixar com progresso', async () => {
    let resolveDownload!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveDownload = resolve
    })
    const api = installMockApi({
      'update:download': () => pending.then(() => ({ ok: true as const, path: '/tmp/x.dmg' }))
    })
    renderWithProviders(<UpdateBanner />, { withIssueDetail: false })
    api.push('push:update-available', { version: '1.2.3', url: 'https://x/release' })
    await waitFor(() => expect(screen.getByText('Versão 1.2.3 disponível')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Baixar e instalar/ }))
    expect(screen.getByRole('button', { name: /Baixando… 0%/ })).toBeDisabled()

    api.push('push:update-progress', { percent: 42 })
    await waitFor(() => expect(screen.getByText('Baixando… 42%')).toBeInTheDocument())

    resolveDownload()
    await waitFor(() =>
      expect(screen.getByText('Instalador aberto — conclua a instalação')).toBeInTheDocument()
    )
    expect(api.count('update:download')).toBe(1)
  })

  it('erro no download mostra a mensagem e permite tentar de novo', async () => {
    const api = installMockApi({
      'update:download': () => {
        throw new MockIpcFailure('DL_FAIL', 'Sem espaço em disco.')
      }
    })
    renderWithProviders(<UpdateBanner />, { withIssueDetail: false })
    api.push('push:update-available', { version: '1.0.0', url: 'https://x/release' })
    await waitFor(() => expect(screen.getByText('Versão 1.0.0 disponível')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Baixar e instalar/ }))
    await waitFor(() => expect(screen.getByText('Sem espaço em disco.')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(api.count('update:download')).toBe(2))
  })

  it('"Ver release" abre a URL numa nova aba', async () => {
    const openSpy = vi.fn()
    const original = window.open
    window.open = openSpy as never
    try {
      const api = installMockApi()
      renderWithProviders(<UpdateBanner />, { withIssueDetail: false })
      api.push('push:update-available', { version: '1.0.0', url: 'https://x/release' })
      await waitFor(() => expect(screen.getByText('Versão 1.0.0 disponível')).toBeInTheDocument())

      await userEvent.click(screen.getByRole('button', { name: /Ver release/ }))
      expect(openSpy).toHaveBeenCalledWith('https://x/release', '_blank')
    } finally {
      window.open = original
    }
  })

  it('dispensar (X) esconde o pill até o próximo push', async () => {
    const api = installMockApi()
    renderWithProviders(<UpdateBanner />, { withIssueDetail: false })
    api.push('push:update-available', { version: '1.0.0', url: 'https://x/release' })
    await waitFor(() => expect(screen.getByText('Versão 1.0.0 disponível')).toBeInTheDocument())

    await userEvent.click(screen.getByTitle('Fechar'))
    expect(screen.queryByText('Versão 1.0.0 disponível')).not.toBeInTheDocument()

    api.push('push:update-available', { version: '1.0.1', url: 'https://x/release' })
    await waitFor(() => expect(screen.getByText('Versão 1.0.1 disponível')).toBeInTheDocument())
  })
})
