// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AdfView } from './AdfView'

/**
 * Render de ADF (Atlassian Document Format): blocos, marcas inline, nós de
 * mídia (com/sem resolver) e degradação de nós desconhecidos.
 */

afterEach(cleanup)

describe('AdfView', () => {
  it('retorna null para doc inválido/vazio', () => {
    const { container: c1 } = render(<AdfView doc={null} />)
    expect(c1.firstChild).toBeNull()
    const { container: c2 } = render(<AdfView doc={{ type: 'doc' }} />)
    expect(c2.firstChild).toBeNull()
    const { container: c3 } = render(<AdfView doc="texto solto" />)
    expect(c3.firstChild).toBeNull()
  })

  it('renderiza parágrafo com todas as marcas inline', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'negrito', marks: [{ type: 'strong' }] },
                { type: 'text', text: ' itálico', marks: [{ type: 'em' }] },
                { type: 'text', text: ' riscado', marks: [{ type: 'strike' }] },
                { type: 'text', text: ' sublinhado', marks: [{ type: 'underline' }] },
                { type: 'text', text: ' código', marks: [{ type: 'code' }] },
                {
                  type: 'text',
                  text: ' link',
                  marks: [{ type: 'link', attrs: { href: 'https://ex.com' } }]
                },
                {
                  type: 'text',
                  text: ' colorido',
                  marks: [{ type: 'textColor', attrs: { color: '#ff0000' } }]
                },
                { type: 'hardBreak' }
              ]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('negrito').tagName).toBe('STRONG')
    expect(screen.getByText('itálico').tagName).toBe('EM')
    expect(screen.getByText('riscado').tagName).toBe('S')
    expect(screen.getByText('sublinhado').tagName).toBe('U')
    expect(screen.getByText('código').tagName).toBe('CODE')
    const link = screen.getByText('link')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://ex.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('colorido').tagName).toBe('SPAN')
  })

  it('renderiza headings com o tamanho certo por nível', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título 1' }] },
            { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'Título 5' }] },
            { type: 'heading', content: [{ type: 'text', text: 'Sem nível' }] }
          ]
        }}
      />
    )
    expect(screen.getByText('Título 1')).toHaveClass('text-base', 'font-bold')
    expect(screen.getByText('Título 5')).toHaveClass('text-sm', 'font-medium')
    expect(screen.getByText('Sem nível')).toHaveClass('text-sm', 'font-semibold')
  })

  it('renderiza listas com marcador, numeradas e taskList', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item bullet' }] }]
                }
              ]
            },
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'item numerado' }] }
                  ]
                }
              ]
            },
            {
              type: 'taskList',
              content: [
                {
                  type: 'taskItem',
                  attrs: { state: 'DONE' },
                  content: [{ type: 'text', text: 'feito' }]
                },
                {
                  type: 'taskItem',
                  attrs: { state: 'TODO' },
                  content: [{ type: 'text', text: 'a fazer' }]
                }
              ]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('item bullet').closest('ul')).toBeInTheDocument()
    expect(screen.getByText('item numerado').closest('ol')).toBeInTheDocument()
    const done = screen.getByText('feito')
    expect(done).toHaveClass('line-through')
    expect(done.previousSibling).toBeChecked()
    const todo = screen.getByText('a fazer')
    expect(todo).not.toHaveClass('line-through')
    expect(todo.previousSibling).not.toBeChecked()
  })

  it('renderiza blockquote, código, regra horizontal e painel', () => {
    const { container } = render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'blockquote',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'citação' }] }]
            },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] },
            { type: 'rule' },
            {
              type: 'panel',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'aviso do painel' }] }]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('citação').closest('blockquote')).toBeInTheDocument()
    expect(screen.getByText('const x = 1').tagName).toBe('PRE')
    expect(container.querySelector('hr')).toBeInTheDocument()
    expect(screen.getByText('aviso do painel')).toBeInTheDocument()
  })

  it('renderiza tabela completa', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableHeader',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Coluna' }] }]
                    }
                  ]
                },
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valor' }] }]
                    }
                  ]
                }
              ]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('Coluna').closest('th')).toBeInTheDocument()
    expect(screen.getByText('Valor').closest('td')).toBeInTheDocument()
  })

  it('renderiza mention, emoji, inlineCard, status e date', () => {
    const { container } = render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'mention', attrs: { text: '@Thiago' } },
                { type: 'text', text: ' ' },
                { type: 'emoji', attrs: { text: '🔥' } },
                { type: 'inlineCard', attrs: { url: 'https://ex.com/card' } },
                { type: 'status', attrs: { text: 'Em revisão' } },
                { type: 'date', attrs: { timestamp: Date.UTC(2026, 0, 15, 12) } }
              ]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('@Thiago')).toBeInTheDocument()
    expect(container.textContent).toContain('🔥')
    expect(screen.getByText('https://ex.com/card')).toHaveAttribute('href', 'https://ex.com/card')
    expect(screen.getByText('Em revisão')).toBeInTheDocument()
    expect(container.textContent).toContain('15/01/2026')
  })

  it('link e menção usam a cor de marca sem variante light: (indigo-400 já é theme-aware)', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'mention', attrs: { text: '@Thiago' } },
                {
                  type: 'text',
                  text: 'um link',
                  marks: [{ type: 'link', attrs: { href: 'https://ex.com' } }]
                }
              ]
            }
          ]
        }}
      />
    )
    const link = screen.getByText('um link')
    expect(link.className).toContain('text-indigo-400')
    expect(link.className).not.toContain('light:')

    const mention = screen.getByText('@Thiago')
    expect(mention.className).toContain('text-indigo-400')
    expect(mention.className).not.toContain('light:')
  })

  it('mediaSingle/mediaGroup sem resolver mostra o placeholder padrão', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [{ type: 'mediaSingle', content: [{ type: 'media', attrs: {} }] }]
        }}
      />
    )
    expect(screen.getByText('[anexo/imagem — ver no Jira]')).toBeInTheDocument()
  })

  it('mediaSingle usa o resolver quando fornecido', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [{ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x' } }] }]
        }}
        mediaResolver={() => <span>imagem resolvida</span>}
      />
    )
    expect(screen.getByText('imagem resolvida')).toBeInTheDocument()
  })

  it('degrada nó desconhecido para o conteúdo interno', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            {
              type: 'algumNoDesconhecido',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'conteúdo interno' }] }
              ]
            }
          ]
        }}
      />
    )
    expect(screen.getByText('conteúdo interno')).toBeInTheDocument()
  })

  it('nó folha desconhecido cai no fallback inline (texto direto)', () => {
    render(
      <AdfView
        doc={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'expressãoDesconhecida', text: 'texto cru' }] }
          ]
        }}
      />
    )
    expect(screen.getByText('texto cru')).toBeInTheDocument()
  })
})
