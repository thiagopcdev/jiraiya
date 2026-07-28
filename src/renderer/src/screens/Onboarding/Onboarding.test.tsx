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
import Onboarding from './Onboarding'

function baseHandlers(): MockHandlers {
  return {
    'auth:connect': () => ({
      workspace: {
        id: 1,
        siteUrl: 'https://biud.atlassian.net',
        email: 'thiago@biud.com.br',
        accountId: 'acc-1',
        displayName: 'Thiago Prado',
        timeZone: 'America/Sao_Paulo'
      }
    }),
    'projects:list': () => ({
      projects: [
        { jiraId: '1', key: 'BT', name: 'Biud Tech', avatarUrl: null, selected: false },
        { jiraId: '2', key: 'ESG', name: 'ESG Dashboard', avatarUrl: null, selected: false }
      ]
    }),
    'projects:setSelected': () => ({ ok: true as const }),
    'sync:run': () => ({ started: true }),
    'sync:status': () => ({
      running: true,
      lastSuccessAt: null,
      lastError: null,
      progress: null
    })
  }
}

function setup(overrides?: (api: MockApiControl) => void): MockApiControl {
  const api = installMockApi(baseHandlers())
  overrides?.(api)
  renderWithProviders(<Onboarding />, { withIssueDetail: false })
  return api
}

async function connectAndReachProjects(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(screen.getByText('Conectar ao Jira')).toBeInTheDocument())
  await user.type(screen.getByLabelText('URL do site'), 'biud.atlassian.net')
  await user.type(screen.getByLabelText('E-mail'), 'thiago@biud.com.br')
  await user.type(screen.getByLabelText(/^API token/), 'meu-token-secreto')
  await user.click(screen.getByRole('button', { name: 'Testar e conectar' }))
  await waitFor(() => expect(screen.getByText('Selecione os projetos')).toBeInTheDocument())
}

describe('Onboarding', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  describe('Conectar', () => {
    it('botão fica desabilitado até preencher os três campos', async () => {
      const user = userEvent.setup()
      setup()
      await waitFor(() => expect(screen.getByText('Conectar ao Jira')).toBeInTheDocument())

      const submit = screen.getByRole('button', { name: 'Testar e conectar' })
      expect(submit).toBeDisabled()

      await user.type(screen.getByLabelText('URL do site'), 'biud.atlassian.net')
      expect(submit).toBeDisabled()
      await user.type(screen.getByLabelText('E-mail'), 'thiago@biud.com.br')
      expect(submit).toBeDisabled()
      await user.type(screen.getByLabelText(/^API token/), 'token')
      expect(submit).not.toBeDisabled()
    })

    it('conecta com sucesso e avança para seleção de projetos', async () => {
      const user = userEvent.setup()
      const api = setup()
      await connectAndReachProjects(user)

      expect(api.lastPayload('auth:connect')).toEqual({
        siteUrl: 'biud.atlassian.net',
        email: 'thiago@biud.com.br',
        apiToken: 'meu-token-secreto'
      })
    })

    it('mostra erro quando conectar falha', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('auth:connect', () => {
          throw new MockIpcFailure('AUTH_FAIL', 'Credenciais inválidas.')
        })
      })
      await waitFor(() => expect(screen.getByText('Conectar ao Jira')).toBeInTheDocument())

      await user.type(screen.getByLabelText('URL do site'), 'biud.atlassian.net')
      await user.type(screen.getByLabelText('E-mail'), 'thiago@biud.com.br')
      await user.type(screen.getByLabelText(/^API token/), 'token-errado')
      await user.click(screen.getByRole('button', { name: 'Testar e conectar' }))

      await waitFor(() => expect(screen.getByText('Credenciais inválidas.')).toBeInTheDocument())
      expect(screen.getByText('Conectar ao Jira')).toBeInTheDocument()
    })
  })

  describe('Selecionar projetos', () => {
    it('lista projetos, exige ao menos um selecionado e volta para conectar', async () => {
      const user = userEvent.setup()
      const api = setup()
      await connectAndReachProjects(user)

      const continueButton = screen.getByRole('button', { name: 'Continuar' })
      expect(continueButton).toBeDisabled()

      await user.click(screen.getByRole('checkbox', { name: /BT.*Biud Tech/ }))
      expect(continueButton).not.toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Voltar' }))
      await waitFor(() => expect(screen.getByText('Conectar ao Jira')).toBeInTheDocument())
      expect(api.count('projects:setSelected')).toBe(0)
    })

    it('mostra "nenhum projeto" e estado de erro', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('projects:list', () => ({ projects: [] }))
      })
      await connectAndReachProjects(user)
      await waitFor(() =>
        expect(screen.getByText('Nenhum projeto encontrado.')).toBeInTheDocument()
      )
    })

    it('confirma seleção e dispara sync inicial', async () => {
      const user = userEvent.setup()
      const api = setup()
      await connectAndReachProjects(user)

      await user.click(screen.getByRole('checkbox', { name: /BT.*Biud Tech/ }))
      await user.click(screen.getByRole('checkbox', { name: /ESG.*ESG Dashboard/ }))
      await user.click(screen.getByRole('button', { name: 'Continuar' }))

      await waitFor(() => expect(api.count('projects:setSelected')).toBe(1))
      expect(api.lastPayload('projects:setSelected')).toEqual({ keys: ['BT', 'ESG'] })
      await waitFor(() => expect(api.count('sync:run')).toBe(1))
      expect(api.lastPayload('sync:run')).toEqual({ full: true })

      await waitFor(() => expect(screen.getByText('Sincronização inicial')).toBeInTheDocument())
    })
  })

  describe('Sincronização inicial', () => {
    async function reachSyncStep(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await connectAndReachProjects(user)
      await user.click(screen.getByRole('checkbox', { name: /BT.*Biud Tech/ }))
      await user.click(screen.getByRole('button', { name: 'Continuar' }))
      await waitFor(() => expect(screen.getByText('Sincronização inicial')).toBeInTheDocument())
    }

    it('mostra a fase corrente com contagem de progresso', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('sync:status', () => ({
          running: true,
          lastSuccessAt: null,
          lastError: null,
          progress: { phase: 'issues', done: 12, total: 50 }
        }))
      })
      await reachSyncStep(user)

      await waitFor(() => expect(screen.getByText('Buscando issues…')).toBeInTheDocument())
      expect(screen.getByText('(12/50)')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Começar a usar' })).toBeDisabled()
    })

    it('mostra erro de sincronização e habilita continuar mesmo assim', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('sync:status', () => ({
          running: false,
          lastSuccessAt: null,
          lastError: 'Falha na sincronização',
          progress: null
        }))
      })
      await reachSyncStep(user)

      await waitFor(() => expect(screen.getByText('Falha na sincronização')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Começar a usar' })).not.toBeDisabled()
    })

    it('ao concluir via push:sync-complete, mostra "Tudo pronto!" e permite começar a usar', async () => {
      const user = userEvent.setup()
      const api = setup()
      await reachSyncStep(user)

      const startButton = screen.getByRole('button', { name: 'Começar a usar' })
      expect(startButton).toBeDisabled()

      api.push('push:sync-complete', { success: true, error: null })
      await waitFor(() => expect(screen.getByText('Tudo pronto!')).toBeInTheDocument())
      expect(startButton).not.toBeDisabled()

      await user.click(startButton)
    })

    it('push:sync-complete com success=false não conclui', async () => {
      const user = userEvent.setup()
      const api = setup()
      await reachSyncStep(user)

      api.push('push:sync-complete', { success: false, error: 'falhou' })
      expect(screen.queryByText('Tudo pronto!')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Começar a usar' })).toBeDisabled()
    })
  })
})
