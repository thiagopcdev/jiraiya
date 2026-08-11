// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, type MockApiControl } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { useMentionPicker } from './mentionPicker'

const USERS = [
  { accountId: '557058:abc', displayName: 'Thiago Prado' },
  { accountId: '557058:def', displayName: 'Ana Lúcia' }
]

function Harness({ initial = '' }: { initial?: string }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(initial)
  const [sent, setSent] = useState('')
  const mention = useMentionPicker({ textareaRef: ref, value, onChange: setValue })
  return (
    <>
      <textarea
        ref={ref}
        aria-label="comentário"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        {...mention.textareaProps}
      />
      {mention.popover}
      <output>{value}</output>
      <button onClick={() => setSent(mention.toMarkdown(value))}>enviar</button>
      <span data-testid="enviado">{sent}</span>
    </>
  )
}

function setup(overrides?: (api: MockApiControl) => void): void {
  const api = installMockApi({
    'users:search': ({ query }) => ({
      users: USERS.filter((u) =>
        u.displayName.toLowerCase().includes(String(query ?? '').toLowerCase())
      ),
      offline: false
    })
  })
  overrides?.(api)
  renderWithProviders(<Harness />, { withIssueDetail: false })
}

afterEach(cleanup)

describe('useMentionPicker', () => {
  it('digitar "@" abre a lista de sugestões', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('@')

    expect(await screen.findByRole('listbox', { name: 'Sugestões de menção' })).toBeInTheDocument()
    expect(await screen.findByText('Thiago Prado')).toBeInTheDocument()
  })

  it('o que se digita depois do "@" filtra a busca', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('@ana')

    await waitFor(() => expect(screen.getByText('Ana Lúcia')).toBeInTheDocument())
    expect(screen.queryByText('Thiago Prado')).not.toBeInTheDocument()
  })

  it('escolher deixa o campo com "@Nome" limpo — sem accountId à vista', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('oi @thi')
    await screen.findByText('Thiago Prado')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('oi @Thiago Prado '))
    expect(screen.getByRole('status').textContent).not.toContain('557058')
    // o menu fecha depois da escolha
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('na hora de enviar, o texto vira markdown com o accountId', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('oi @thi')
    await screen.findByText('Thiago Prado')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('@Thiago Prado'))

    await user.click(screen.getByRole('button', { name: 'enviar' }))
    expect(screen.getByTestId('enviado').textContent).toBe('oi @[Thiago Prado](557058:abc) ')
  })

  it('setas movem a seleção antes do Enter', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('@')
    await screen.findByText('Ana Lúcia')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() =>
      expect(screen.getByRole('status').textContent ?? '').toContain('@Ana Lúcia')
    )
  })

  it('Esc fecha sem inserir nada', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('@thi')
    await screen.findByText('Thiago Prado')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('status').textContent).toBe('@thi')
  })

  it('e-mail não abre o menu — o "@" tem que começar palavra', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByLabelText('comentário'))
    await user.keyboard('thiago@biud')

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })
})
