// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installMockApi,
  MockIpcFailure,
  type MockApiControl,
  type MockHandlers
} from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import Ask from './Ask'

function baseHandlers(): MockHandlers {
  return {
    'queue:list': () => ({ actions: [] }),
    'ai:status': () => ({
      providers: [
        {
          id: 'claude' as const,
          label: 'Claude Code',
          kind: 'cli' as const,
          available: true,
          detail: null,
          models: []
        }
      ],
      active: { id: 'claude' as const, label: 'Claude Code' },
      activePref: 'auto' as const
    })
  }
}

function setup(overrides?: (api: MockApiControl) => void): MockApiControl {
  const api = installMockApi(baseHandlers())
  overrides?.(api)
  renderWithProviders(<Ask />, { withIssueDetail: false })
  return api
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Perguntar ao Jiraiya')).toBeInTheDocument())
}

describe('Ask', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  it('sem provider de IA mostra aviso e não renderiza o input', async () => {
    setup((api) => {
      api.set('ai:status', () => ({ providers: [], active: null, activePref: 'auto' as const }))
    })
    await waitReady()

    // "Perguntar ao Jiraiya" aparece tanto no early-return quanto na tela normal (que é o
    // que renderiza enquanto aiStatus ainda está carregando) — espera o aviso específico.
    await waitFor(() =>
      expect(
        screen.getByText(
          'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
        )
      ).toBeInTheDocument()
    )
    expect(screen.queryByPlaceholderText(/Pergunte algo/)).not.toBeInTheDocument()
  })

  it('chip de sugestão preenche e envia; os chips somem depois da primeira pergunta', async () => {
    const user = userEvent.setup()
    const api = setup((mock) => {
      mock.set('ask:question', () => ({
        answer: 'A sprint travou por causa de um bloqueio externo.',
        generatedBy: 'claude' as const,
        actions: []
      }))
    })
    await waitReady()

    const suggestion = 'O que travou a sprint essa semana?'
    const others = [
      'Resume o feedback que recebi nos meus cards',
      'Quais cards estão parados e por quê?'
    ]
    expect(screen.getByRole('button', { name: suggestion })).toBeInTheDocument()
    others.forEach((chip) => expect(screen.getByRole('button', { name: chip })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: suggestion }))

    await waitFor(() => expect(api.count('ask:question')).toBe(1))
    expect(api.lastPayload('ask:question')).toEqual({ question: suggestion, history: [] })
    await waitFor(() =>
      expect(
        screen.getByText('A sprint travou por causa de um bloqueio externo.')
      ).toBeInTheDocument()
    )
    // a pergunta do usuário aparece na conversa, mas os chips saíram do composer
    expect(screen.getByText(suggestion)).toBeInTheDocument()
    others.forEach((chip) =>
      expect(screen.queryByRole('button', { name: chip })).not.toBeInTheDocument()
    )
  })

  it('digita e envia com Enter (sem Shift); Shift+Enter não envia', async () => {
    const user = userEvent.setup()
    const api = setup((mock) => {
      mock.set('ask:question', () => ({
        answer: 'Resposta rápida.',
        generatedBy: 'claude' as const,
        actions: []
      }))
    })
    await waitReady()

    const textarea = screen.getByPlaceholderText('Pergunte algo sobre seus cards, sprint ou time…')
    await user.type(textarea, 'linha 1{Shift>}{enter}{/Shift}linha 2')
    expect(api.count('ask:question')).toBe(0)

    await user.type(textarea, '{enter}')
    await waitFor(() => expect(api.count('ask:question')).toBe(1))
    expect(api.lastPayload('ask:question')?.question).toBe('linha 1\nlinha 2')
  })

  it('mostra "Pensando…" enquanto aguarda e trata erro da IA', async () => {
    const user = userEvent.setup()
    let resolveFn: () => void = () => {}
    const api = setup((mock) => {
      mock.set(
        'ask:question',
        () =>
          new Promise((resolve) => {
            resolveFn = () => resolve({ answer: 'ok', generatedBy: 'claude' as const, actions: [] })
          })
      )
    })
    await waitReady()

    const textarea = screen.getByPlaceholderText('Pergunte algo sobre seus cards, sprint ou time…')
    await user.type(textarea, 'pergunta pendente')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(screen.getByText(/Pensando…/)).toBeInTheDocument())
    resolveFn()
    await waitFor(() => expect(screen.queryByText(/Pensando…/)).not.toBeInTheDocument())
    expect(api.count('ask:question')).toBe(1)

    // agora simula falha
    api.set('ask:question', () => {
      throw new MockIpcFailure('AI_FAIL', 'A IA está indisponível no momento.')
    })
    await user.type(textarea, 'outra pergunta')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(screen.getByText('A IA está indisponível no momento.')).toBeInTheDocument()
    )
  })

  it('propõe ações, executa com sucesso, trata erro e permite descartar', async () => {
    const user = userEvent.setup()
    let executeShouldFail = true
    const api = setup((mock) => {
      mock.set('ask:question', () => ({
        answer: 'Posso atribuir o card BT-200 a você e comentar.',
        generatedBy: 'claude' as const,
        actions: [
          { type: 'assign_me' as const, key: 'BT-200' },
          { type: 'comment' as const, key: 'BT-201', text: 'Podemos priorizar isso?' }
        ]
      }))
      mock.set('ask:execute', () => {
        if (executeShouldFail) throw new MockIpcFailure('EXEC_FAIL', 'Falha ao executar a ação.')
        return { ok: true as const, message: 'Atribuído a você.' }
      })
    })
    await waitReady()

    const textarea = screen.getByPlaceholderText('Pergunte algo sobre seus cards, sprint ou time…')
    await user.type(textarea, 'atribui o BT-200 a mim e comenta no BT-201')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    // "Atribuir a você" é um dos nós de texto dentro do <p> (ao lado do botão da key e do
    // ": "), então o match precisa ser parcial em vez de igualdade exata do nó
    await waitFor(() => expect(screen.getByText(/Atribuir a você/)).toBeInTheDocument())
    expect(screen.getByText(/Comentar: "Podemos priorizar isso\?"/)).toBeInTheDocument()

    const executeButtons = screen.getAllByRole('button', { name: 'Executar' })
    expect(executeButtons).toHaveLength(2)

    // primeira ação falha
    await user.click(executeButtons[0])
    await waitFor(() => expect(screen.getByText('Falha ao executar a ação.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()

    // tenta de novo, agora com sucesso
    executeShouldFail = false
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(screen.getByText('Atribuído a você.')).toBeInTheDocument())
    expect(api.count('ask:execute')).toBe(2)

    // descarta a segunda ação (comentário)
    const discardButtons = screen.getAllByRole('button', { name: 'Descartar' })
    await user.click(discardButtons[0])
    await waitFor(() =>
      expect(screen.queryByText(/Comentar: "Podemos priorizar isso\?"/)).not.toBeInTheDocument()
    )
  })

  it('limpa a conversa', async () => {
    const user = userEvent.setup()
    setup((mock) => {
      mock.set('ask:question', () => ({
        answer: 'resposta',
        generatedBy: 'claude' as const,
        actions: []
      }))
    })
    await waitReady()

    const textarea = screen.getByPlaceholderText('Pergunte algo sobre seus cards, sprint ou time…')
    await user.type(textarea, 'oi{enter}')
    await waitFor(() => expect(screen.getByText('resposta')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Limpar conversa/ }))
    await waitFor(() =>
      expect(
        screen.getByText('Pergunte qualquer coisa sobre o seu Jira — ou comece por uma sugestão:')
      ).toBeInTheDocument()
    )
    expect(screen.queryByText('resposta')).not.toBeInTheDocument()
  })

  it('cabeçalho mostra o provider ativo e o botão de limpar só existe com conversa', async () => {
    const user = userEvent.setup()
    setup((mock) => {
      mock.set('ask:question', () => ({
        answer: 'resposta',
        generatedBy: 'claude' as const,
        actions: []
      }))
    })
    await waitReady()

    await waitFor(() =>
      expect(
        screen.getByText(
          'Claude Code · Responde com base nos seus dados locais (janela de backfill)'
        )
      ).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /Limpar conversa/ })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Pergunte algo/), 'oi{enter}')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Limpar conversa/ })).toBeInTheDocument()
    )
  })

  it('compositor e conversa dividem a mesma coluna de 780px centrada', async () => {
    const user = userEvent.setup()
    setup()
    await waitReady()

    const composer = screen.getByPlaceholderText(/Pergunte algo/).closest('.max-w-\\[780px\\]')
    expect(composer).toHaveClass('mx-auto')

    await user.type(screen.getByPlaceholderText(/Pergunte algo/), 'oi{enter}')
    const thread = (await screen.findByText('oi')).closest('.max-w-\\[780px\\]')
    expect(thread).toHaveClass('mx-auto')
  })

  it('enquanto espera a resposta mostra os pontinhos com rótulo acessível', async () => {
    const user = userEvent.setup()
    setup((mock) => {
      mock.set('ask:question', () => new Promise(() => {}))
    })
    await waitReady()

    await user.type(screen.getByPlaceholderText(/Pergunte algo/), 'demora?{enter}')
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Pensando…')
  })
})
