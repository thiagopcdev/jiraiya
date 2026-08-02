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
import Filters from './Filters'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-100',
    projectKey: 'BT',
    summary: 'Corrigir bug crítico no login',
    descriptionText: null,
    issueType: 'Bug',
    status: 'A fazer',
    statusCategory: 'new',
    priority: 'Highest',
    assigneeAccountId: null,
    assigneeName: null,
    reporterAccountId: null,
    reporterName: null,
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
    'filters:list': () => ({
      filters: [{ id: 1, name: 'Bugs críticos', jql: 'priority = Highest', position: 0 }]
    }),
    'filters:run': () => ({ issues: [makeIssue()], truncated: false }),
    'filters:save': () => ({ id: 2 }),
    'filters:delete': () => ({ ok: true as const })
  }
}

function setup(overrides?: (api: MockApiControl) => void): MockApiControl {
  const api = installMockApi(baseHandlers())
  overrides?.(api)
  renderWithProviders(<Filters />)
  return api
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Bugs críticos')).toBeInTheDocument())
}

describe('Filters', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  it('mostra carregando e depois vazio quando não há filtros salvos', async () => {
    setup((api) => {
      api.set('filters:list', () => ({ filters: [] }))
    })
    await waitFor(() => expect(screen.getByText('Nenhum filtro salvo ainda.')).toBeInTheDocument())
    expect(screen.getByText('Execute o JQL para ver os resultados.')).toBeInTheDocument()
  })

  it('carrega um filtro salvo, roda o JQL e mostra resultados', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    await user.click(screen.getByRole('button', { name: 'Bugs críticos' }))

    await waitFor(() => expect(api.count('filters:run')).toBe(1))
    expect(api.lastPayload('filters:run')).toEqual({ jql: 'priority = Highest' })

    const nameInput = screen.getByPlaceholderText('Ex.: Bugs críticos abertos') as HTMLInputElement
    expect(nameInput.value).toBe('Bugs críticos')
    const jqlInput = screen.getAllByRole('textbox')[1]
    expect(jqlInput).toHaveValue('priority = Highest')

    await waitFor(() => expect(screen.getByText('1 resultado')).toBeInTheDocument())
    expect(screen.getByText('Corrigir bug crítico no login')).toBeInTheDocument()
  })

  it('mostra dica de truncamento quando o resultado é maior que o limite', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('filters:run', () => ({
        issues: [makeIssue(), makeIssue({ jiraId: '2', key: 'BT-101' })],
        truncated: true
      }))
    })
    await waitReady()

    const jqlTextarea = screen.getAllByRole('textbox')[1]
    await user.type(jqlTextarea, 'project = BT')
    await user.click(screen.getByRole('button', { name: 'Executar' }))

    await waitFor(() => expect(screen.getByText('2 resultados')).toBeInTheDocument())
    expect(screen.getByText('Mostrando os primeiros 50.')).toBeInTheDocument()
  })

  it('mostra "nenhum resultado" e trata erro ao executar', async () => {
    const user = userEvent.setup()
    let shouldFail = false
    const api = setup((mock) => {
      mock.set('filters:run', () => {
        if (shouldFail) throw new MockIpcFailure('JQL_INVALID', 'JQL inválido.')
        return { issues: [], truncated: false }
      })
    })
    await waitReady()

    const jqlTextarea = screen.getAllByRole('textbox')[1]
    await user.type(jqlTextarea, 'status = Done AND resolution = Unresolved')
    await user.click(screen.getByRole('button', { name: 'Executar' }))
    await waitFor(() => expect(screen.getByText('Nenhum resultado.')).toBeInTheDocument())

    shouldFail = true
    await user.click(screen.getByRole('button', { name: 'Executar' }))
    await waitFor(() => expect(screen.getByText('JQL inválido.')).toBeInTheDocument())
    expect(api.count('filters:run')).toBe(2)
  })

  it('cria um novo filtro e salva', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    const nameInput = screen.getByPlaceholderText('Ex.: Bugs críticos abertos')
    const jqlTextarea = screen.getAllByRole('textbox')[1]
    await user.type(nameInput, 'Meus cards da sprint')
    await user.type(jqlTextarea, 'assignee = currentUser() AND sprint in openSprints()')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(api.count('filters:save')).toBe(1))
    expect(api.lastPayload('filters:save')).toEqual({
      id: undefined,
      name: 'Meus cards da sprint',
      jql: 'assignee = currentUser() AND sprint in openSprints()'
    })
  })

  it('mostra erro ao salvar', async () => {
    const user = userEvent.setup()
    setup((api) => {
      api.set('filters:save', () => {
        throw new MockIpcFailure('SAVE_FAIL', 'Falha ao salvar o filtro.')
      })
    })
    await waitReady()

    await user.type(screen.getByPlaceholderText('Ex.: Bugs críticos abertos'), 'X')
    await user.type(screen.getAllByRole('textbox')[1], 'project = BT')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('Falha ao salvar o filtro.')).toBeInTheDocument())
  })

  it('edita um filtro existente pelo lápis e salva a alteração', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    await user.click(screen.getByTitle('Editar'))
    await waitFor(() => expect(api.count('filters:run')).toBe(1))

    const nameInput = screen.getByPlaceholderText('Ex.: Bugs críticos abertos') as HTMLInputElement
    expect(nameInput.value).toBe('Bugs críticos')
    await user.clear(nameInput)
    await user.type(nameInput, 'Bugs críticos (P1)')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.lastPayload('filters:save')).toEqual({
        id: 1,
        name: 'Bugs críticos (P1)',
        jql: 'priority = Highest'
      })
    )
  })

  it('+ Novo filtro reseta o formulário', async () => {
    const user = userEvent.setup()
    setup()
    await waitReady()

    await user.click(screen.getByTitle('Editar'))
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Ex.: Bugs críticos abertos') as HTMLInputElement).value
      ).toBe('Bugs críticos')
    )

    await user.click(screen.getByTitle('+ Novo filtro'))
    expect(
      (screen.getByPlaceholderText('Ex.: Bugs críticos abertos') as HTMLInputElement).value
    ).toBe('')
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('')
    expect(screen.getByText('Execute o JQL para ver os resultados.')).toBeInTheDocument()
  })

  it('exclui um filtro após confirmar; cancelar não exclui', async () => {
    const user = userEvent.setup()
    const api = setup()
    await waitReady()

    await user.click(screen.getByTitle('Excluir'))
    expect(screen.getByText('Excluir?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Não' }))
    expect(screen.queryByText('Excluir?')).not.toBeInTheDocument()
    expect(api.count('filters:delete')).toBe(0)

    await user.click(screen.getByTitle('Excluir'))
    api.set('filters:list', () => ({ filters: [] }))
    await user.click(screen.getByRole('button', { name: 'Sim' }))
    await waitFor(() => expect(api.count('filters:delete')).toBe(1))
    expect(api.lastPayload('filters:delete')).toEqual({ id: 1 })
    await waitFor(() => expect(screen.getByText('Nenhum filtro salvo ainda.')).toBeInTheDocument())
  })
})
