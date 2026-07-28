// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi, MockIpcFailure } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { MarkdownToolbar } from './MarkdownToolbar'

afterEach(cleanup)

function Harness({
  initialValue = '',
  aiContext
}: {
  initialValue?: string
  aiContext?: 'description' | 'comment'
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(initialValue)
  return (
    <div>
      <MarkdownToolbar textareaRef={ref} value={value} onChange={setValue} aiContext={aiContext} />
      <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  )
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

function select(start: number, end: number): void {
  const el = getTextarea()
  el.focus()
  el.setSelectionRange(start, end)
}

const aiActive = {
  providers: [
    { id: 'claude', label: 'Claude', kind: 'cli', available: true, detail: null, models: [] }
  ],
  active: { id: 'claude', label: 'Claude' },
  activePref: 'auto'
} as const

const aiUnavailable = { providers: [], active: null, activePref: 'auto' } as const

describe('MarkdownToolbar', () => {
  it('negrito envolve a seleção com **', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="olá mundo" />, { withIssueDetail: false })
    select(4, 9)
    await userEvent.click(screen.getByRole('button', { name: 'Negrito (Cmd+B)' }))
    expect(getTextarea().value).toBe('olá **mundo**')
  })

  it('negrito sem seleção insere placeholder', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="" />, { withIssueDetail: false })
    select(0, 0)
    await userEvent.click(screen.getByRole('button', { name: 'Negrito (Cmd+B)' }))
    expect(getTextarea().value).toBe('**texto**')
  })

  it('itálico envolve com *', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="olá mundo" />, { withIssueDetail: false })
    select(4, 9)
    await userEvent.click(screen.getByRole('button', { name: 'Itálico (Cmd+I)' }))
    expect(getTextarea().value).toBe('olá *mundo*')
  })

  it('riscado envolve com ~~', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="olá mundo" />, { withIssueDetail: false })
    select(4, 9)
    await userEvent.click(screen.getByRole('button', { name: 'Riscado' }))
    expect(getTextarea().value).toBe('olá ~~mundo~~')
  })

  it('código envolve com `', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="olá mundo" />, { withIssueDetail: false })
    select(4, 9)
    await userEvent.click(screen.getByRole('button', { name: 'Código' }))
    expect(getTextarea().value).toBe('olá `mundo`')
  })

  it('link com seleção vira [label](url) com url selecionável', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="veja aqui" />, { withIssueDetail: false })
    select(5, 9)
    await userEvent.click(screen.getByRole('button', { name: 'Link (Cmd+K)' }))
    expect(getTextarea().value).toBe('veja [aqui](url)')
  })

  it('link sem seleção insere [texto](url)', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="" />, { withIssueDetail: false })
    select(0, 0)
    await userEvent.click(screen.getByRole('button', { name: 'Link (Cmd+K)' }))
    expect(getTextarea().value).toBe('[texto](url)')
  })

  it('título alterna ## por linha (adiciona e depois remove)', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="Minha seção" />, { withIssueDetail: false })
    select(0, 11)
    const btn = screen.getByRole('button', { name: 'Título' })
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('## Minha seção')

    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('Minha seção')
  })

  it('lista adiciona "- " em cada linha selecionada', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue={'item um\nitem dois'} />, { withIssueDetail: false })
    select(0, getTextarea().value.length)
    await userEvent.click(screen.getByRole('button', { name: 'Lista' }))
    expect(getTextarea().value).toBe('- item um\n- item dois')
  })

  it('lista numerada numera as linhas e depois remove', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue={'a\nb\nc'} />, { withIssueDetail: false })
    const btn = screen.getByRole('button', { name: 'Lista numerada' })
    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('1. a\n2. b\n3. c')

    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('a\nb\nc')
  })

  it('checklist adiciona "- [ ] " e depois remove', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue={'tarefa 1'} />, { withIssueDetail: false })
    const btn = screen.getByRole('button', { name: 'Checklist' })
    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('- [ ] tarefa 1')

    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('tarefa 1')
  })

  it('citação adiciona "> " e depois remove', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue={'frase'} />, { withIssueDetail: false })
    const btn = screen.getByRole('button', { name: 'Citação' })
    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('> frase')

    select(0, getTextarea().value.length)
    await userEvent.click(btn)
    expect(getTextarea().value).toBe('frase')
  })

  it('bloco de código envolve as linhas com ```', async () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue={'const x = 1'} />, { withIssueDetail: false })
    select(0, getTextarea().value.length)
    await userEvent.click(screen.getByRole('button', { name: 'Bloco de código' }))
    expect(getTextarea().value).toBe('```\nconst x = 1\n```')
  })

  it('tooltip do botão mostra o título ao lado do ícone', () => {
    installMockApi({ 'ai:status': () => aiUnavailable as never })
    renderWithProviders(<Harness initialValue="" />, { withIssueDetail: false })
    expect(screen.getByText('Negrito (Cmd+B)')).toBeInTheDocument()
  })

  describe('botão "Formatar com IA"', () => {
    it('fica escondido sem aiContext mesmo com provider ativo', () => {
      installMockApi({ 'ai:status': () => aiActive as never })
      renderWithProviders(<Harness initialValue="texto" />, { withIssueDetail: false })
      expect(screen.queryByRole('button', { name: 'Formatar com IA' })).not.toBeInTheDocument()
    })

    it('fica escondido com aiContext mas sem provider disponível', async () => {
      installMockApi({ 'ai:status': () => aiUnavailable as never })
      renderWithProviders(<Harness initialValue="texto" aiContext="description" />, {
        withIssueDetail: false
      })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Negrito (Cmd+B)' })).toBeInTheDocument()
      )
      expect(screen.queryByRole('button', { name: 'Formatar com IA' })).not.toBeInTheDocument()
    })

    it('aparece com aiContext + provider ativo, reescreve o texto e permite desfazer', async () => {
      const api = installMockApi({
        'ai:status': () => aiActive as never,
        'text:polish': () => ({ text: 'texto reescrito', generatedBy: 'claude' })
      })
      renderWithProviders(<Harness initialValue="texto original" aiContext="description" />, {
        withIssueDetail: false
      })
      const btn = await screen.findByRole('button', { name: 'Formatar com IA' })
      await userEvent.click(btn)

      await waitFor(() => expect(getTextarea().value).toBe('texto reescrito'))
      expect(api.lastPayload('text:polish')).toEqual({
        text: 'texto original',
        context: 'description'
      })

      const undo = screen.getByText('Desfazer')
      await userEvent.click(undo)
      expect(getTextarea().value).toBe('texto original')
      expect(screen.queryByText('Desfazer')).not.toBeInTheDocument()
    })

    it('não faz nada com o texto vazio (guard de whitespace)', async () => {
      const api = installMockApi({ 'ai:status': () => aiActive as never })
      renderWithProviders(<Harness initialValue="   " aiContext="comment" />, {
        withIssueDetail: false
      })
      const btn = await screen.findByRole('button', { name: 'Formatar com IA' })
      await userEvent.click(btn)
      expect(api.count('text:polish')).toBe(0)
    })

    it('erro do provider mostra mensagem e some sozinho depois', async () => {
      installMockApi({
        'ai:status': () => aiActive as never,
        'text:polish': () => {
          throw new MockIpcFailure('AI_FAIL', 'IA indisponível agora.')
        }
      })
      renderWithProviders(<Harness initialValue="texto" aiContext="comment" />, {
        withIssueDetail: false
      })
      const btn = await screen.findByRole('button', { name: 'Formatar com IA' })
      await userEvent.click(btn)
      // aparece duas vezes: no tooltip do botão e no texto visível ao lado
      await waitFor(() => expect(screen.getAllByText('IA indisponível agora.')).toHaveLength(2))
      expect(getTextarea().value).toBe('texto')
    })
  })
})
