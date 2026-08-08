// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@shared/domain'
import { installMockApi, type MockApiControl } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { ProjectPicker } from './ProjectPicker'

afterEach(cleanup)

const PROJETOS: Project[] = [
  { jiraId: '1', key: 'BT', name: 'Bitcap', avatarUrl: null, selected: true },
  { jiraId: '2', key: 'XX', name: 'Outro projeto', avatarUrl: null, selected: false }
]

function setup(projects: Project[] = PROJETOS): MockApiControl {
  const api = installMockApi({
    'projects:list': () => ({ projects }),
    'projects:setSelected': () => ({ ok: true as const })
  } as never)
  renderWithProviders(<ProjectPicker />, { withIssueDetail: false })
  return api
}

async function abrir(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Projetos acompanhados' }))
  return screen.getByRole('menu', { name: 'Projetos acompanhados' })
}

describe('ProjectPicker', () => {
  it('começa fechado e o gatilho declara aria-expanded', () => {
    setup()
    const gatilho = screen.getByRole('button', { name: 'Projetos acompanhados' })
    expect(gatilho).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('abre listando os projetos, com marca de conferido só no acompanhado', async () => {
    const user = userEvent.setup()
    setup()
    const menu = await abrir(user)

    await waitFor(() =>
      expect(within(menu).getByRole('menuitemcheckbox', { name: /Bitcap/ })).toBeInTheDocument()
    )
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Bitcap/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Outro projeto/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('marcar um projeto manda a lista nova pelo projects:setSelected', async () => {
    const user = userEvent.setup()
    const api = setup()
    const menu = await abrir(user)

    await waitFor(() =>
      expect(
        within(menu).getByRole('menuitemcheckbox', { name: /Outro projeto/ })
      ).toBeInTheDocument()
    )
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /Outro projeto/ }))

    await waitFor(() =>
      expect(api.lastPayload('projects:setSelected')).toEqual({ keys: ['BT', 'XX'] })
    )
  })

  it('desmarcar o último projeto é ignorado — o app ficaria sem o que sincronizar', async () => {
    const user = userEvent.setup()
    const api = setup([PROJETOS[0]])
    const menu = await abrir(user)

    await waitFor(() =>
      expect(within(menu).getByRole('menuitemcheckbox', { name: /Bitcap/ })).toBeInTheDocument()
    )
    await user.click(within(menu).getByRole('menuitemcheckbox', { name: /Bitcap/ }))

    expect(api.count('projects:setSelected')).toBe(0)
  })

  it('sem projeto sincronizado, avisa em vez de listar nada', async () => {
    const user = userEvent.setup()
    setup([])
    const menu = await abrir(user)
    await waitFor(() =>
      expect(within(menu).getByText('Nenhum projeto sincronizado.')).toBeInTheDocument()
    )
  })

  it('Esc fecha o popover', async () => {
    const user = userEvent.setup()
    setup()
    await abrir(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('clique fora fecha o popover', async () => {
    const user = userEvent.setup()
    setup()
    await abrir(user)
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('o rodapé leva para Configurações e fecha o popover', async () => {
    const user = userEvent.setup()
    setup()
    const menu = await abrir(user)

    const link = within(menu).getByRole('link', { name: 'Gerenciar em Configurações' })
    expect(link).toHaveAttribute('href', '/config')
    await user.click(link)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
