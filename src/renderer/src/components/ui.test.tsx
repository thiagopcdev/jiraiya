// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Badge, Button, Card, EmptyState, Input, Spinner } from './ui'

afterEach(cleanup)

describe('ui — componentes de apoio', () => {
  describe('Button', () => {
    it('renderiza os children e responde a clique (variant padrão = primary)', async () => {
      const onClick = vi.fn()
      render(<Button onClick={onClick}>Salvar</Button>)
      const btn = screen.getByRole('button', { name: 'Salvar' })
      expect(btn.className).toContain('bg-indigo-600')
      await userEvent.click(btn)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it.each(['secondary', 'ghost', 'danger'] as const)(
      'aplica o estilo do variant "%s"',
      (variant) => {
        render(<Button variant={variant}>X</Button>)
        expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument()
      }
    )

    it('repassa disabled e className extra', () => {
      render(
        <Button disabled className="extra-class">
          Desabilitado
        </Button>
      )
      const btn = screen.getByRole('button', { name: 'Desabilitado' })
      expect(btn).toBeDisabled()
      expect(btn.className).toContain('extra-class')
    })
  })

  describe('Input', () => {
    it('associa o label ao campo e mostra hint', () => {
      render(<Input label="Nome" hint="opcional" placeholder="digite" />)
      const input = screen.getByLabelText(/Nome/)
      expect(input).toHaveAttribute('placeholder', 'digite')
      expect(screen.getByText('opcional')).toBeInTheDocument()
    })

    it('sem label nem hint, renderiza só o input', () => {
      render(<Input placeholder="sem label" />)
      expect(screen.getByPlaceholderText('sem label')).toBeInTheDocument()
    })

    it('aceita digitação e propaga onChange', async () => {
      const onChange = vi.fn()
      render(<Input placeholder="campo" onChange={onChange} />)
      await userEvent.type(screen.getByPlaceholderText('campo'), 'abc')
      expect(onChange).toHaveBeenCalledTimes(3)
    })
  })

  describe('Card', () => {
    it('sem title, não renderiza heading', () => {
      render(<Card>conteúdo</Card>)
      expect(screen.getByText('conteúdo')).toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('com title (string ou nó), renderiza o cabeçalho', () => {
      render(
        <Card title={<span>Título rico</span>} className="custom">
          conteúdo
        </Card>
      )
      expect(screen.getByText('Título rico')).toBeInTheDocument()
    })
  })

  describe('Spinner', () => {
    it('renderiza com a classe de animação e aceita className extra', () => {
      const { container } = render(<Spinner className="text-red-500" />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('class')).toContain('animate-spin')
      expect(svg?.getAttribute('class')).toContain('text-red-500')
    })
  })

  describe('Badge', () => {
    it('cor padrão é zinc', () => {
      render(<Badge>rótulo</Badge>)
      expect(screen.getByText('rótulo').className).toContain('bg-zinc-800')
    })

    it.each(['green', 'blue', 'amber', 'red', 'indigo'] as const)('aplica a cor "%s"', (color) => {
      render(<Badge color={color}>x-{color}</Badge>)
      expect(screen.getByText(`x-${color}`)).toBeInTheDocument()
    })
  })

  describe('EmptyState', () => {
    it('mostra a mensagem informada', () => {
      render(<EmptyState message="Nada por aqui ainda." />)
      expect(screen.getByText('Nada por aqui ainda.')).toBeInTheDocument()
    })
  })
})
