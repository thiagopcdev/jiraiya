// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Badge,
  Button,
  Card,
  CollapsedStats,
  EmptyState,
  Input,
  ScreenHeader,
  SegmentedControl,
  Spinner,
  Toggle
} from './ui'

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

    it('renderiza a faixa de título com actions à direita', () => {
      render(
        <Card title="Em andamento" actions={<button>ordenar</button>}>
          conteúdo
        </Card>
      )
      expect(screen.getByRole('heading', { name: 'Em andamento' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ordenar' })).toBeInTheDocument()
    })

    it('só com actions (sem title), ainda renderiza a faixa', () => {
      render(<Card actions={<button>ação</button>}>conteúdo</Card>)
      expect(screen.getByRole('button', { name: 'ação' })).toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('bodyClassName troca o padding do corpo', () => {
      render(<Card bodyClassName="">sangrado</Card>)
      expect(screen.getByText('sangrado').className).not.toContain('p-4')
    })
  })

  describe('Toggle', () => {
    it('expõe role switch com aria-checked e alterna ao clicar', async () => {
      const onChange = vi.fn()
      render(<Toggle checked={false} onChange={onChange} aria-label="Atribuir a mim" />)
      const sw = screen.getByRole('switch', { name: 'Atribuir a mim' })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      await userEvent.click(sw)
      expect(onChange).toHaveBeenCalledWith(true)
    })

    it('ligado, devolve false no próximo clique e pinta o trilho de marca', async () => {
      const onChange = vi.fn()
      render(<Toggle checked onChange={onChange} aria-label="Usar IA" />)
      const sw = screen.getByRole('switch', { name: 'Usar IA' })
      expect(sw.className).toContain('bg-indigo-600')
      await userEvent.click(sw)
      expect(onChange).toHaveBeenCalledWith(false)
    })

    it('desabilitado não dispara onChange', async () => {
      const onChange = vi.fn()
      render(<Toggle checked={false} onChange={onChange} disabled aria-label="Bloqueado" />)
      await userEvent.click(screen.getByRole('switch', { name: 'Bloqueado' }))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('SegmentedControl', () => {
    const options = [
      { value: 'hoje' as const, label: 'Hoje' },
      { value: '7d' as const, label: '7 dias' },
      { value: 'sprint' as const, label: 'Sprint' }
    ]

    it('marca o item ativo com aria-pressed e o estilo de marca', () => {
      render(
        <SegmentedControl options={options} value="7d" onChange={vi.fn()} aria-label="Período" />
      )
      const ativo = screen.getByRole('button', { name: '7 dias' })
      expect(ativo).toHaveAttribute('aria-pressed', 'true')
      expect(ativo.className).toContain('bg-indigo-600')
      expect(screen.getByRole('button', { name: 'Hoje' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('devolve o valor da opção clicada', async () => {
      const onChange = vi.fn()
      render(<SegmentedControl options={options} value="hoje" onChange={onChange} />)
      await userEvent.click(screen.getByRole('button', { name: 'Sprint' }))
      expect(onChange).toHaveBeenCalledWith('sprint')
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

    it('a variante brand é pastilha de marca, não retângulo cinza', () => {
      render(<Badge color="brand">4</Badge>)
      const pill = screen.getByText('4')
      expect(pill.className).toContain('rounded-full')
      expect(pill.className).toContain('text-indigo-400')
    })
  })

  describe('EmptyState', () => {
    it('mostra a mensagem informada', () => {
      render(<EmptyState message="Nada por aqui ainda." />)
      expect(screen.getByText('Nada por aqui ainda.')).toBeInTheDocument()
    })
  })

  describe('ScreenHeader', () => {
    it('renderiza título, contexto e ações', () => {
      render(
        <ScreenHeader
          title="Hoje"
          context="quinta, 2 de agosto · Sprint 47"
          actions={<button>Nova daily</button>}
        />
      )
      expect(screen.getByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
      expect(screen.getByText('quinta, 2 de agosto · Sprint 47')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Nova daily' })).toBeInTheDocument()
    })

    it('sem contexto nem ações, renderiza só o título', () => {
      render(<ScreenHeader title="Quadro" />)
      expect(screen.getByRole('heading', { name: 'Quadro' })).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('flush tira a borda inferior (quem fecha é a faixa de abas)', () => {
      const { container } = render(<ScreenHeader title="Criar" flush />)
      expect(container.querySelector('header')?.className).not.toContain('border-b')
    })
  })

  describe('CollapsedStats', () => {
    const items = [
      { label: 'Reprovados', count: 0 },
      { label: 'Parados', count: 0 },
      { label: 'Sem estimativa', count: 0 }
    ]

    it('com todos os contadores zerados, mostra a linha única e não renderiza children', () => {
      render(
        <CollapsedStats items={items} allClearLabel="Nada pendente">
          <div>lista de atenção</div>
        </CollapsedStats>
      )
      expect(screen.getByText('Nada pendente')).toBeInTheDocument()
      expect(screen.getByText('Reprovados 0 · Parados 0 · Sem estimativa 0')).toBeInTheDocument()
      expect(screen.queryByText('lista de atenção')).not.toBeInTheDocument()
    })

    it('com um contador > 0, renderiza children e não a linha única', () => {
      const withCount = [items[0], { label: 'Parados', count: 2 }, items[2]]
      render(
        <CollapsedStats items={withCount} allClearLabel="Nada pendente">
          <div>lista de atenção</div>
        </CollapsedStats>
      )
      expect(screen.getByText('lista de atenção')).toBeInTheDocument()
      expect(screen.queryByText('Nada pendente')).not.toBeInTheDocument()
    })
  })
})
