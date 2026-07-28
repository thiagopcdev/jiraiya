// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Issue } from '@shared/domain'
import {
  installMockApi,
  MockIpcFailure,
  type MockApiControl,
  type MockHandlers
} from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import Split from './Split'

/** Card "mãe" usado como base nos testes — só os campos que a tela realmente lê. */
function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-100',
    projectKey: 'BT',
    summary: 'Migrar autenticação para OAuth',
    descriptionText: 'Descrição original do card.',
    issueType: 'Story',
    status: 'Em progresso',
    statusCategory: 'indeterminate',
    priority: 'Medium',
    assigneeAccountId: 'acc-1',
    assigneeName: 'Thiago Prado',
    reporterAccountId: 'acc-1',
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: null,
    updatedAt: null,
    resolvedAt: null,
    url: 'https://biud.atlassian.net/browse/BT-100',
    ...overrides
  }
}

function baseHandlers(): MockHandlers {
  return {
    'queue:list': () => ({ actions: [] }),
    'issues:query': () => ({ issues: [makeIssue()] }),
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
    }),
    'issueTypes:list': () => ({
      issueTypes: [
        { id: 'sub-1', name: 'Subtarefa', subtask: true },
        { id: 'story-1', name: 'Story', subtask: false },
        { id: 'bug-1', name: 'Bug', subtask: false }
      ]
    }),
    'issues:get': () => ({ issue: makeIssue() }),
    'issues:splitDraft': () => ({
      items: [
        { title: 'Configurar provider OAuth', description: 'Detalhar passos.' },
        { title: 'Migrar telas de login', description: '' }
      ],
      rationale: 'Dividido por camada técnica.',
      generatedBy: 'claude' as const
    }),
    'issues:split': () => ({ keys: ['BT-101', 'BT-102'], commentPosted: true }),
    'sync:run': () => ({ started: true }),
    'shell:openIssue': () => ({ ok: true as const })
  }
}

function setup(overrides?: (api: MockApiControl) => void): MockApiControl {
  const api = installMockApi(baseHandlers())
  overrides?.(api)
  renderWithProviders(<Split />)
  return api
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Qual card dividir?')).toBeInTheDocument())
}

describe('Split', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  it('lista os meus cards abertos e permite selecionar um', async () => {
    const user = userEvent.setup()
    setup()
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')

    await waitFor(() =>
      expect(screen.getByText('Migrar autenticação para OAuth')).toBeInTheDocument()
    )
    expect(screen.getByText('Descrição original do card.')).toBeInTheDocument()
    expect(screen.getByText('Story')).toBeInTheDocument()
  })

  it('busca por key manual, trata não encontrado e erro', async () => {
    const user = userEvent.setup()
    const api = setup((mock) => {
      mock.set('issues:get', () => ({ issue: null }))
    })
    await waitReady()

    const manualInput = screen.getByLabelText('ou informe a key')
    await user.type(manualInput, 'BT-999')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))

    await waitFor(() =>
      expect(
        screen.getByText('Card não encontrado localmente — verifique a key ou sincronize.')
      ).toBeInTheDocument()
    )
    expect(api.count('issues:get')).toBe(1)

    api.set('issues:get', () => {
      throw new MockIpcFailure('BOOM', 'Falha ao buscar o card.')
    })
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(screen.getByText('Falha ao buscar o card.')).toBeInTheDocument())

    api.set('issues:get', () => ({ issue: makeIssue({ key: 'BT-999' }) }))
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(screen.getByText('BT-999')).toBeInTheDocument())
  })

  it('mostra aviso quando nenhum provider de IA está disponível', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('ai:status', () => ({
        providers: [],
        active: null,
        activePref: 'auto' as const
      }))
    })
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')

    await waitFor(() =>
      expect(
        screen.getByText(
          'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
        )
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /Analisar com IA/ })).toBeDisabled()
  })

  it('analisa, edita itens, adiciona/remove e refina', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')
    await waitFor(() =>
      expect(screen.getByText('Migrar autenticação para OAuth')).toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: /Analisar com Claude Code/ }))
    await waitFor(() => expect(api.count('issues:splitDraft')).toBe(1))
    await waitFor(() =>
      expect(screen.getByText('Dividido por camada técnica.')).toBeInTheDocument()
    )

    const titleInputs = screen.getAllByLabelText(/^Título \d/)
    expect(titleInputs).toHaveLength(2)
    expect((titleInputs[0] as HTMLInputElement).value).toBe('Configurar provider OAuth')

    await user.clear(titleInputs[0])
    await user.type(titleInputs[0], 'Configurar OAuth no backend')
    expect((titleInputs[0] as HTMLInputElement).value).toBe('Configurar OAuth no backend')

    await user.click(screen.getByRole('button', { name: '+ Adicionar item' }))
    expect(screen.getAllByLabelText(/^Título \d/)).toHaveLength(3)

    const removeButtons = screen.getAllByRole('button', { name: 'Remover item' })
    await user.click(removeButtons[removeButtons.length - 1])
    expect(screen.getAllByLabelText(/^Título \d/)).toHaveLength(2)

    // refino com feedback
    api.set('issues:splitDraft', () => ({
      items: [{ title: 'Item refinado', description: 'Nova descrição' }],
      rationale: 'Critério ajustado pelo feedback.',
      generatedBy: 'claude' as const
    }))
    const feedback = screen.getByLabelText('Feedback para a IA')
    await user.type(feedback, 'junte tudo em um item só')
    await user.click(screen.getByRole('button', { name: /Refinar com Claude Code/ }))

    await waitFor(() => expect(api.count('issues:splitDraft')).toBe(2))
    expect(api.lastPayload('issues:splitDraft')).toMatchObject({
      parentKey: 'BT-100',
      feedback: 'junte tudo em um item só'
    })
    await waitFor(() =>
      expect(screen.getByText('Critério ajustado pelo feedback.')).toBeInTheDocument()
    )
    expect(screen.getAllByLabelText(/^Título \d/)).toHaveLength(1)
  })

  it('mostra erro quando analisar falha', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('issues:splitDraft', () => {
        throw new MockIpcFailure('AI_FAIL', 'Falha ao analisar o card.')
      })
    })
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')
    await user.click(screen.getByRole('button', { name: /Analisar com Claude Code/ }))

    await waitFor(() => expect(screen.getByText('Falha ao analisar o card.')).toBeInTheDocument())
  })

  it('estrutura: alterna subtarefa/irmão, tipo e atribuir a mim; cria os cards', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')
    await user.click(screen.getByRole('button', { name: /Analisar com Claude Code/ }))
    await waitFor(() =>
      expect(screen.getByText('Dividido por camada técnica.')).toBeInTheDocument()
    )

    // subtarefa é o padrão (há tipo de subtarefa disponível)
    expect(screen.getByRole('radio', { name: 'Subtarefas do card original' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Cards irmãos (mesmo projeto)' }))
    const typeSelect = screen.getByLabelText('Tipo') as HTMLSelectElement
    await waitFor(() => expect(typeSelect).toBeInTheDocument())
    // projectKey do parent é 'BT' e issueType 'Story' -> default deve ser Story
    expect(typeSelect.value).toBe('story-1')
    await user.selectOptions(typeSelect, 'bug-1')

    const assignCheckbox = screen.getByRole('checkbox', { name: 'Atribuir a mim' })
    expect(assignCheckbox).toBeChecked()
    await user.click(assignCheckbox)

    await user.click(screen.getByRole('button', { name: 'Criar 2 cards no Jira' }))

    await waitFor(() => expect(api.count('issues:split')).toBe(1))
    expect(api.lastPayload('issues:split')).toMatchObject({
      parentKey: 'BT-100',
      mode: 'sibling',
      issueTypeId: 'bug-1',
      assignToMe: false
    })
    await waitFor(() => expect(api.count('sync:run')).toBe(1))

    await waitFor(() =>
      expect(screen.getByText('2 cards criados a partir de BT-100')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'BT-101' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'BT-102' })).toBeInTheDocument()

    // "Dividir outro" reseta tudo, de volta pro passo inicial
    await user.click(screen.getByRole('button', { name: 'Dividir outro' }))
    await waitFor(() => expect(screen.getByText('Qual card dividir?')).toBeInTheDocument())
    expect(screen.queryByText('2 cards criados a partir de BT-100')).not.toBeInTheDocument()
  })

  it('mostra aviso de comentário falho e erro de criação', async () => {
    const user = userEvent.setup()
    let shouldFail = true
    const api = setup((mock) => {
      mock.set('issues:split', () => {
        if (shouldFail) throw new MockIpcFailure('CREATE_FAIL', 'Falha ao criar os cards.')
        return { keys: ['BT-101'], commentPosted: false }
      })
    })
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')
    await user.click(screen.getByRole('button', { name: /Analisar com Claude Code/ }))
    await waitFor(() =>
      expect(screen.getByText('Dividido por camada técnica.')).toBeInTheDocument()
    )

    await user.click(screen.getByRole('button', { name: 'Criar 2 cards no Jira' }))
    await waitFor(() => expect(screen.getByText('Falha ao criar os cards.')).toBeInTheDocument())
    expect(api.count('issues:split')).toBe(1)

    shouldFail = false
    await user.click(screen.getByRole('button', { name: 'Criar 2 cards no Jira' }))
    await waitFor(() =>
      expect(screen.getByText('1 card criado a partir de BT-100')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Os cards foram criados, mas o comentário no card original falhou.')
    ).toBeInTheDocument()
  })

  it('abre o card original no Jira pelo ícone externo', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    const select = screen.getByLabelText('Meus cards abertos') as HTMLSelectElement
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, 'BT-100')
    await user.click(screen.getByRole('button', { name: /Analisar com Claude Code/ }))
    await waitFor(() =>
      expect(screen.getByText('Dividido por camada técnica.')).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: 'Criar 2 cards no Jira' }))
    await waitFor(() =>
      expect(screen.getByText('2 cards criados a partir de BT-100')).toBeInTheDocument()
    )

    await user.click(screen.getByTitle('Abrir BT-100 no Jira'))
    await waitFor(() => expect(api.lastPayload('shell:openIssue')).toEqual({ issueKey: 'BT-100' }))
  })
})
