// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelCombobox } from './ModelCombobox'

afterEach(cleanup)

const models = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' }
]

/** Wrapper controlado — o combobox só sincroniza `text` quando `value` muda por fora. */
function Harness({
  initialValue = '',
  hasKey = true,
  loading = false,
  id
}: {
  initialValue?: string
  hasKey?: boolean
  loading?: boolean
  id?: string
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  return (
    <ModelCombobox
      id={id}
      value={value}
      onChange={setValue}
      models={models}
      hasKey={hasKey}
      loading={loading}
    />
  )
}

describe('ModelCombobox', () => {
  it('sem chave, mostra a dica e ainda aceita digitar um id livre', async () => {
    render(<Harness hasKey={false} />)
    expect(
      screen.getByText('Salve a chave para listar modelos; você ainda pode digitar um id.')
    ).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.type(input, 'meu/modelo-livre')
    await userEvent.tab()
    expect(input).toHaveValue('meu/modelo-livre')
  })

  it('o id vai para o input, que é o que a linha de configuração rotula', () => {
    render(
      <div>
        <label htmlFor="modelo-resumos">Resumos</label>
        <Harness id="modelo-resumos" />
      </div>
    )
    expect(screen.getByLabelText('Resumos')).toBe(screen.getByPlaceholderText(/id do modelo/))
  })

  it('foco abre a lista completa de modelos', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.click(input)
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  })

  it('digitar filtra por id ou nome (case-insensitive)', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.type(input, 'GPT')
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.queryByText('Claude 3.5 Sonnet')).not.toBeInTheDocument()
  })

  it('selecionar um modelo da lista preenche o input e chama onChange', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.click(input)
    await userEvent.click(screen.getByText('Claude 3.5 Sonnet'))
    expect(input).toHaveValue('anthropic/claude-3.5-sonnet')
    expect(screen.queryByText('GPT-4o')).not.toBeInTheDocument()
  })

  it('Enter confirma o texto livre digitado e fecha a lista', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.type(input, 'algum/id{Enter}')
    expect(input).toHaveValue('algum/id')
    expect(screen.queryByText('Claude 3.5 Sonnet')).not.toBeInTheDocument()
  })

  it('Escape fecha a lista sem alterar o valor', async () => {
    render(<Harness initialValue="claude" />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.click(input)
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Claude 3.5 Sonnet')).not.toBeInTheDocument()
    expect(input).toHaveValue('claude')
  })

  it('perder o foco (blur) confirma o texto digitado', async () => {
    render(<Harness />)
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.type(input, 'texto-blur')
    await userEvent.tab()
    expect(input).toHaveValue('texto-blur')
  })

  it('clicar fora (mousedown) fecha a lista aberta', async () => {
    render(
      <div>
        <Harness />
        <button>fora</button>
      </div>
    )
    const input = screen.getByPlaceholderText(/id do modelo/)
    await userEvent.click(input)
    expect(screen.getByText('Claude 3.5 Sonnet')).toBeInTheDocument()

    await userEvent.click(screen.getByText('fora'))
    await waitFor(() => expect(screen.queryByText('Claude 3.5 Sonnet')).not.toBeInTheDocument())
  })

  it('loading mostra "Carregando…" mesmo com lista vazia', async () => {
    function EmptyLoading(): React.JSX.Element {
      const [value, setValue] = useState('')
      return <ModelCombobox value={value} onChange={setValue} models={[]} hasKey loading />
    }
    render(<EmptyLoading />)
    await userEvent.click(screen.getByPlaceholderText(/id do modelo/))
    expect(screen.getByText('Carregando…')).toBeInTheDocument()
  })

  it('sem modelos e sem loading, a lista não abre', async () => {
    function Empty(): React.JSX.Element {
      const [value, setValue] = useState('')
      return <ModelCombobox value={value} onChange={setValue} models={[]} hasKey />
    }
    render(<Empty />)
    await userEvent.click(screen.getByPlaceholderText(/id do modelo/))
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument()
  })

  it('sincroniza o texto quando o value muda por fora (troca de provider)', async () => {
    function Controlled(): React.JSX.Element {
      const [value, setValue] = useState('id-inicial')
      return (
        <div>
          <ModelCombobox value={value} onChange={setValue} models={models} hasKey />
          <button onClick={() => setValue('id-trocado-por-fora')}>trocar</button>
        </div>
      )
    }
    render(<Controlled />)
    const input = screen.getByPlaceholderText(/id do modelo/) as HTMLInputElement
    expect(input.value).toBe('id-inicial')
    await userEvent.click(screen.getByText('trocar'))
    expect(input.value).toBe('id-trocado-por-fora')
  })
})
