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
import Create from './Create'

/**
 * Ao criar com sucesso, `submit()` chama `openIssue(key)` — a gaveta real (IssueDetailProvider)
 * monta e dispara vários canais próprios. Sem mockar esses canais o teste ainda passa (o
 * mockApi resolve NO_MOCK como erro de query, não uma exceção), mas cobrimos com respostas
 * vazias/seguras para validar de fato que a gaveta abre com o card criado.
 */
function baseHandlers(): MockHandlers {
  return {
    'queue:list': () => ({ actions: [] }),
    'projects:list': () => ({
      projects: [
        { jiraId: '1', key: 'BT', name: 'Biud Tech', avatarUrl: null, selected: true },
        { jiraId: '2', key: 'ESG', name: 'ESG Dashboard', avatarUrl: null, selected: false }
      ]
    }),
    'issueTypes:list': () => ({
      issueTypes: [
        { id: 'story-1', name: 'Story', subtask: false },
        { id: 'bug-1', name: 'Bug', subtask: false }
      ]
    }),
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
    'sprint:active': () => ({ sprint: null }),
    'issues:draft': () => ({
      title: 'Migrar autenticação para OAuth',
      description: 'Descrição gerada pela IA.',
      generatedBy: 'claude' as const
    }),
    'issues:create': () => ({ key: 'BT-201' }),
    'sync:run': () => ({ started: true }),
    'shell:openIssue': () => ({ ok: true as const }),
    'search:global': () => ({ results: [] }),
    // canais só usados quando a gaveta (IssueDetailProvider) abre um card
    'issues:get': () => ({
      issue: {
        jiraId: '201',
        key: 'BT-201',
        projectKey: 'BT',
        summary: 'Migrar autenticação para OAuth',
        descriptionText: null,
        issueType: 'Story',
        status: 'A fazer',
        statusCategory: 'new' as const,
        priority: null,
        assigneeAccountId: null,
        assigneeName: null,
        reporterAccountId: null,
        storyPoints: null,
        sprintJiraId: null,
        labels: [],
        parentKey: null,
        flagged: false,
        createdAt: null,
        updatedAt: null,
        resolvedAt: null,
        url: 'https://biud.atlassian.net/browse/BT-201'
      }
    }),
    'issues:comments': () => ({ comments: [] }),
    'issues:description': () => ({ description: null, markdown: null }),
    'issues:transitions': () => ({ transitions: [] }),
    'issues:children': () => ({ issues: [] }),
    'issues:links': () => ({ links: [] }),
    'issues:editMeta': () => ({
      storyPointsEditable: true,
      priority: { editable: false, current: null, options: [] },
      severity: null,
      timeSpent: null,
      originalEstimate: null,
      timeTrackingEditable: false
    }),
    'issues:changelog': () => ({ entries: [] }),
    'watch:status': () => ({ watching: false }),
    'issues:attachments': () => ({ attachments: [] }),
    'issues:activity': () => ({ activities: [] })
  }
}

function setup(overrides?: (api: MockApiControl) => void, route?: string): MockApiControl {
  const api = installMockApi(baseHandlers())
  overrides?.(api)
  renderWithProviders(<Create />, { route })
  return api
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Onde')).toBeInTheDocument())
}

describe('Create', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  it('carrega tipos do projeto padrão (primeiro selecionado)', async () => {
    setup()
    await waitReady()

    const projectSelect = screen.getByLabelText('Projeto') as HTMLSelectElement
    await waitFor(() => expect(projectSelect.value).toBe('BT'))
    const typeSelect = screen.getByLabelText('Tipo') as HTMLSelectElement
    await waitFor(() => expect(typeSelect.value).toBe('story-1'))
  })

  it('gera com IA e preenche título/descrição', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    const idea = screen.getByLabelText('Descreva a ideia da task')
    await user.type(idea, 'permitir login via OAuth do Google')

    await user.click(screen.getByRole('button', { name: /Gerar título e descrição/ }))
    await waitFor(() => expect(api.count('issues:draft')).toBe(1))
    expect(api.lastPayload('issues:draft')).toEqual({
      idea: 'permitir login via OAuth do Google',
      projectKey: 'BT',
      issueType: 'Story'
    })

    const titleInput = screen.getByRole('textbox', { name: /^Título/ }) as HTMLInputElement
    await waitFor(() => expect(titleInput.value).toBe('Migrar autenticação para OAuth'))
  })

  it('mostra aviso e desabilita gerar quando IA está indisponível', async () => {
    setup((api) => {
      api.set('ai:status', () => ({ providers: [], active: null, activePref: 'auto' as const }))
    })
    await waitReady()

    expect(
      screen.getByText(
        'Configure um provider de IA em Ajustes (Claude, Gemini, Codex ou OpenRouter)'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gerar título e descrição/ })).toBeDisabled()
  })

  it('mostra erro quando gerar com IA falha', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('issues:draft', () => {
        throw new MockIpcFailure('AI_FAIL', 'Falha ao gerar com IA.')
      })
    })
    await waitReady()

    await user.type(screen.getByLabelText('Descreva a ideia da task'), 'algo')
    await user.click(screen.getByRole('button', { name: /Gerar título e descrição/ }))
    await waitFor(() => expect(screen.getByText('Falha ao gerar com IA.')).toBeInTheDocument())
  })

  it('mostra cards parecidos (duplicados) ao digitar um título', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('search:global', () => ({
        results: [
          {
            key: 'BT-050',
            summary: 'Login com OAuth já implementado',
            status: 'Concluído',
            statusCategory: 'done' as const,
            url: 'https://x.atlassian.net/browse/BT-050',
            snippet: null,
            match: 'title' as const
          }
        ]
      }))
    })
    await waitReady()

    const titleInput = screen.getByRole('textbox', { name: /^Título/ })
    await user.type(titleInput, 'Login OAuth Google integração')

    await waitFor(
      () => expect(screen.getByText('Cards parecidos já existem:')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Login com OAuth já implementado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'BT-050' })).toBeInTheDocument()
  })

  it('cria a task com sucesso e abre a gaveta do card criado', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    await user.type(
      screen.getByRole('textbox', { name: /^Título/ }),
      'Migrar autenticação para OAuth'
    )
    await user.click(screen.getByRole('button', { name: 'Criar no Jira' }))

    await waitFor(() => expect(api.count('issues:create')).toBe(1))
    expect(api.lastPayload('issues:create')).toMatchObject({
      projectKey: 'BT',
      issueTypeId: 'story-1',
      summary: 'Migrar autenticação para OAuth',
      assignToMe: true
    })
    await waitFor(() => expect(api.count('sync:run')).toBe(1))

    await waitFor(() => expect(screen.getByText('Task BT-201 criada')).toBeInTheDocument())
    // gaveta aberta automaticamente pelo openIssue(res.key) — o header dela mostra a key
    // isolada (fora da frase "Task BT-201 criada"), prova de que o drawer real montou
    await waitFor(() => expect(screen.getByText('BT-201')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Iniciar timer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Criar outra' }))
    await waitFor(() => expect(screen.getByText('Onde')).toBeInTheDocument())
    expect(screen.queryByText('Task BT-201 criada')).not.toBeInTheDocument()
  })

  it('mostra erro quando criar falha', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('issues:create', () => {
        throw new MockIpcFailure('CREATE_FAIL', 'Falha ao criar a task.')
      })
    })
    await waitReady()

    await user.type(screen.getByRole('textbox', { name: /^Título/ }), 'Algo')
    await user.click(screen.getByRole('button', { name: 'Criar no Jira' }))
    await waitFor(() => expect(screen.getByText('Falha ao criar a task.')).toBeInTheDocument())
  })

  it('pré-preenche a ideia vinda do command palette (?idea=)', async () => {
    setup(undefined, '/create?idea=permitir%20anexos%20maiores')
    await waitReady()

    const idea = screen.getByLabelText('Descreva a ideia da task') as HTMLTextAreaElement
    expect(idea.value).toBe('permitir anexos maiores')
  })

  it('mostra opção de sprint ativa quando há sprint em andamento', async () => {
    setup((api) => {
      api.set('sprint:active', () => ({
        sprint: {
          jiraId: 1,
          boardId: 1,
          name: 'Sprint 42',
          state: 'active',
          startDate: null,
          endDate: null,
          completeDate: null,
          goal: null
        } as never
      }))
    })
    await waitReady()

    await waitFor(() =>
      expect(screen.getByText('Adicionar à sprint ativa — Sprint 42')).toBeInTheDocument()
    )
  })
})
