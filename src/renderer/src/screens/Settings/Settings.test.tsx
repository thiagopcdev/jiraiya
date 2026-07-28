// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_PREFS } from '@shared/domain'
import type { Prefs } from '@shared/domain'
import {
  installMockApi,
  MockIpcFailure,
  type MockApiControl,
  type MockHandlers
} from '../../testing/mockApi'
import { renderWithProviders } from '../../testing/render'
import Settings from './Settings'

/**
 * Settings agrega ~12 Cards independentes, todos renderizados juntos — por isso cada teste
 * precisa de um conjunto completo de handlers (senão os Cards que não são o alvo do teste
 * caem no estado de erro NO_MOCK e podem interferir na busca por texto/role). `baseHandlers`
 * cobre o cenário "tudo conectado, tudo disponível"; testes de estado alternativo (desconectado,
 * IA indisponível, gh ausente) sobrescrevem só o necessário via `api.set`.
 */

function baseHandlers(prefsState: Prefs): MockHandlers {
  return {
    'auth:status': () => ({
      connected: true,
      workspace: {
        id: 1,
        siteUrl: 'https://biud.atlassian.net',
        email: 'thiago@biud.com.br',
        accountId: 'acc-1',
        displayName: 'Thiago Prado',
        timeZone: 'America/Sao_Paulo'
      }
    }),
    'auth:disconnect': () => ({ ok: true as const }),
    'prefs:get': () => ({ ...prefsState }),
    'prefs:set': (patch: Partial<Prefs>) => {
      Object.assign(prefsState, patch)
      return { ...prefsState }
    },
    'projects:list': () => ({
      projects: [
        { jiraId: '1', key: 'BT', name: 'Biud Tech', avatarUrl: null, selected: true },
        { jiraId: '2', key: 'ESG', name: 'ESG Dashboard', avatarUrl: null, selected: false }
      ]
    }),
    'projects:setSelected': () => ({ ok: true as const }),
    'prs:status': () => ({ ghAvailable: true, enabled: true }),
    'ai:status': () => ({
      providers: [
        {
          id: 'claude' as const,
          label: 'Claude Code',
          kind: 'cli' as const,
          available: true,
          detail: '/usr/local/bin/claude',
          models: [
            { id: 'sonnet', label: 'Sonnet' },
            { id: 'opus', label: 'Opus' }
          ]
        },
        {
          id: 'gemini' as const,
          label: 'Gemini CLI',
          kind: 'cli' as const,
          available: false,
          detail: 'não instalado',
          models: []
        },
        {
          id: 'codex' as const,
          label: 'Codex CLI',
          kind: 'cli' as const,
          available: false,
          detail: 'não instalado',
          models: []
        },
        {
          id: 'openrouter' as const,
          label: 'OpenRouter',
          kind: 'api' as const,
          available: false,
          detail: null,
          models: []
        }
      ],
      active: { id: 'claude' as const, label: 'Claude Code' },
      activePref: 'auto' as const
    }),
    'ai:openrouterModels': () => ({
      models: [
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        { id: 'openai/gpt-4o', name: 'GPT-4o' }
      ]
    }),
    'ai:setOpenRouterKey': () => ({ ok: true as const }),
    'ai:clearOpenRouterKey': () => ({ ok: true as const }),
    'templates:list': () => ({
      templates: [] as Array<{ id: number; name: string; content: string }>
    }),
    'templates:save': () => ({ template: { id: 1, name: 'Novo', content: 'x' } }),
    'templates:delete': () => ({ ok: true as const }),
    'backup:export': () => ({ ok: true as const, path: '/Users/thiago/backup.json' }),
    'backup:import': () => ({
      ok: true as const,
      canceled: false,
      imported: { notes: 2, watches: 3, filters: 1, templates: 0, prefs: true }
    }),
    'update:setToken': () => ({ ok: true as const }),
    'app:tempFiles': () => ({ bytes: 2048 }),
    'app:tempClear': () => ({ ok: true as const, freedBytes: 2048 }),
    'app:info': () => ({ version: '1.2.3' }),
    'commandLog:list': () => ({ entries: [] as never[] }),
    'commandLog:clear': () => ({ ok: true as const })
  }
}

function setup(overrides?: (api: MockApiControl, prefsState: Prefs) => void): MockApiControl {
  const prefsState: Prefs = { ...DEFAULT_PREFS }
  const api = installMockApi(baseHandlers(prefsState) as never)
  overrides?.(api, prefsState)
  renderWithProviders(<Settings />, { withIssueDetail: false })
  return api
}

async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Thiago Prado')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('Jiraiya v1.2.3')).toBeInTheDocument())
}

/** Cada Card renderiza `<h3>{title}</h3>` seguido do conteúdo, no mesmo container — usado
 * para escopar queries quando o mesmo texto/role aparece em mais de um Card ao mesmo tempo
 * (ex.: botão "Salvar" existe em Ajustes de IA, Templates e Atualizações simultaneamente). */
function getCard(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  return heading.parentElement as HTMLElement
}

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  describe('Conta', () => {
    it('mostra workspace conectado e desconecta', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      expect(
        screen.getByText('thiago@biud.com.br · https://biud.atlassian.net')
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Desconectar' }))
      await waitFor(() => expect(api.count('auth:disconnect')).toBe(1))
    })

    it('sem conta conectada mostra mensagem', async () => {
      setup((api) => {
        api.set('auth:status', () => ({ connected: false, workspace: null }))
      })
      await waitFor(() => expect(screen.getByText('Nenhuma conta conectada.')).toBeInTheDocument())
    })
  })

  describe('Aparência', () => {
    it('troca o tema e grava em prefs', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const select = screen.getByLabelText('Tema') as HTMLSelectElement
      await user.selectOptions(select, 'light')

      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ theme: 'light' }))
    })
  })

  describe('Lembrete de tempo', () => {
    it('alterna o checkbox e edita o horário', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const checkbox = screen.getByRole('checkbox', { name: /Lembrar de registrar tempo/ })
      expect(checkbox).toBeChecked()
      await user.click(checkbox)
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ worklogReminder: false }))

      const timeInput = screen.getByLabelText(/Horário do lembrete/) as HTMLInputElement
      fireEvent.change(timeInput, { target: { value: '08:00' } })
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ worklogReminderTime: '08:00' })
      )
    })
  })

  describe('Projetos acompanhados', () => {
    it('alterna seleção de projeto', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      await user.click(screen.getByRole('button', { name: 'ESG' }))
      await waitFor(() =>
        expect(api.lastPayload('projects:setSelected')).toEqual({ keys: ['BT', 'ESG'] })
      )
    })
  })

  describe('Sincronização e alertas', () => {
    it('grava mudanças de selects e checkboxes', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      await user.selectOptions(screen.getByLabelText('Intervalo de sincronização'), '60')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ syncIntervalMinutes: 60 }))

      await user.selectOptions(screen.getByLabelText('Janela de histórico (backfill)'), '90')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ backfillDays: 90 }))

      await user.selectOptions(screen.getByLabelText('Considerar ticket parado após'), '7')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ stalledDays: 7 }))

      await user.selectOptions(screen.getByLabelText('Modo de sincronização'), 'personal')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ syncMode: 'personal' }))

      await user.click(screen.getByRole('checkbox', { name: /card for atribuído a mim/ }))
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ notifyAssignedToMe: false })
      )

      await user.click(screen.getByRole('checkbox', { name: /eu for mencionado/ }))
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ notifyMentions: false }))

      await user.click(screen.getByRole('checkbox', { name: /alertas críticos/ }))
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ notifyCriticalAlerts: true })
      )

      await user.click(screen.getByRole('checkbox', { name: /daily no primeiro uso/ }))
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ morningBriefing: false }))
    })
  })

  describe('Pull requests (GitHub)', () => {
    it('alterna integração e edita escopo', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const prCard = getCard('Pull requests (GitHub)')
      await user.click(within(prCard).getByRole('checkbox', { name: /Mostrar PRs relacionados/ }))
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ prIntegration: true }))

      // o hint do Input entra no textContent do <label>, então o match precisa ser parcial
      const scope = within(prCard).getByLabelText(/Escopo da busca/)
      // input controlado direto pelo valor de prefs (round-trip via invalidateQueries) —
      // digitar tecla a tecla causaria corrida com o refetch; um único change reflete
      // o mesmo onChange do componente.
      fireEvent.change(scope, { target: { value: 'org:biudtech' } })
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ prSearchScope: 'org:biudtech' })
      )
    })

    it('mostra aviso quando gh não está disponível', async () => {
      setup((api) => {
        api.set('prs:status', () => ({ ghAvailable: false, enabled: false }))
      })
      await waitFor(() => expect(screen.getByText(/CLI gh não encontrado/)).toBeInTheDocument())
    })
  })

  describe('Inteligência artificial', () => {
    it('lista providers, troca o ativo e edita modelo por função', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const aiCard = getCard('Inteligência artificial')
      expect(within(aiCard).getByText('/usr/local/bin/claude')).toBeInTheDocument()

      const providerSelect = within(aiCard).getByLabelText('Provider ativo')
      await user.selectOptions(providerSelect, 'gemini')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ aiProvider: 'gemini' }))

      const modelSelect = within(aiCard).getByLabelText('Resumos (daily/weekly/1:1)')
      await user.selectOptions(modelSelect, 'opus')
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({
          aiModels: { claude: { summaries: 'opus' } }
        })
      )
    })

    it('mostra aviso quando nenhum provider está disponível', async () => {
      setup((api) => {
        api.set('ai:status', () => ({
          providers: [
            {
              id: 'claude' as const,
              label: 'Claude Code',
              kind: 'cli' as const,
              available: false,
              detail: 'não instalado',
              models: []
            }
          ],
          active: null,
          activePref: 'auto' as const
        }))
      })
      await waitFor(() =>
        expect(screen.getByText(/Nenhum provider de IA disponível/)).toBeInTheDocument()
      )
    })

    it('salva a chave da OpenRouter, trata erro e remove', async () => {
      const user = userEvent.setup()
      let shouldFail = true
      const api = setup((mock) => {
        mock.set('ai:setOpenRouterKey', () => {
          if (shouldFail) throw new MockIpcFailure('INVALID_KEY', 'Chave inválida.')
          return { ok: true as const }
        })
      })
      await waitReady()

      const aiCard = getCard('Inteligência artificial')
      const keyInput = within(aiCard).getByPlaceholderText('sk-or-…')
      await user.type(keyInput, 'sk-or-teste')
      await user.click(within(aiCard).getByRole('button', { name: 'Salvar' }))

      await waitFor(() => expect(within(aiCard).getByText('Chave inválida.')).toBeInTheDocument())
      expect(api.count('ai:setOpenRouterKey')).toBe(1)

      // ajusta o mock para suceder e reenvia
      shouldFail = false
      api.set('ai:status', () => ({
        providers: [
          {
            id: 'openrouter' as const,
            label: 'OpenRouter',
            kind: 'api' as const,
            available: true,
            detail: 'chave configurada',
            models: []
          }
        ],
        active: { id: 'openrouter' as const, label: 'OpenRouter' },
        activePref: 'openrouter' as const
      }))

      await user.click(within(aiCard).getByRole('button', { name: 'Salvar' }))
      await waitFor(() =>
        expect(within(aiCard).getByRole('button', { name: 'Remover' })).toBeInTheDocument()
      )

      await user.click(within(aiCard).getByRole('button', { name: 'Remover' }))
      await waitFor(() => expect(api.count('ai:clearOpenRouterKey')).toBe(1))
    })

    it('exibe ModelCombobox quando o provider ativo é openrouter', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('ai:status', () => ({
          providers: [
            {
              id: 'openrouter' as const,
              label: 'OpenRouter',
              kind: 'api' as const,
              available: true,
              detail: 'chave configurada',
              models: []
            }
          ],
          active: { id: 'openrouter' as const, label: 'OpenRouter' },
          activePref: 'openrouter' as const
        }))
      })
      await waitReady()

      // AI_FEATURES renderiza um ModelCombobox por funcionalidade — escopa ao label
      // "Resumos (daily/weekly/1:1)" para pegar só o combobox daquela linha.
      const summariesLabel = screen.getByText('Resumos (daily/weekly/1:1)')
      const row = within(summariesLabel.parentElement as HTMLElement)
      const combo = row.getByPlaceholderText('id do modelo (ex.: anthropic/claude-3.5-sonnet)')
      await user.click(combo)
      await waitFor(() => expect(row.getByText('GPT-4o')).toBeInTheDocument())
      await user.click(row.getByText('GPT-4o'))

      await waitFor(() => expect((combo as HTMLInputElement).value).toBe('openai/gpt-4o'))
    })

    it('abre a modal de comandos executados', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await user.click(screen.getByRole('button', { name: /Ver comandos executados/ }))
      await waitFor(() =>
        expect(screen.getByText('Nenhum comando registrado.')).toBeInTheDocument()
      )

      await user.click(screen.getByRole('button', { name: 'Fechar' }))
      await waitFor(() =>
        expect(screen.queryByText('Nenhum comando registrado.')).not.toBeInTheDocument()
      )
    })
  })

  describe('Templates de comentário', () => {
    it('cria, edita e apaga um template', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const tplCard = getCard('Templates de comentário')
      await user.click(within(tplCard).getByRole('button', { name: '+ Novo template' }))
      await user.type(within(tplCard).getByLabelText('Nome'), 'Aviso de bloqueio')
      // '{{' escapa a sintaxe de teclas especiais do userEvent.type — '}' sozinho já é literal
      await user.type(
        within(tplCard).getByLabelText('Conteúdo'),
        'Estamos bloqueados por {{motivo}.'
      )

      api.set('templates:list', () => ({
        templates: [
          { id: 1, name: 'Aviso de bloqueio', content: 'Estamos bloqueados por {motivo}.' }
        ]
      }))
      await user.click(within(tplCard).getByRole('button', { name: 'Salvar' }))

      await waitFor(() => expect(api.count('templates:save')).toBe(1))
      expect(api.lastPayload('templates:save')).toEqual({
        id: undefined,
        name: 'Aviso de bloqueio',
        content: 'Estamos bloqueados por {motivo}.'
      })
      await waitFor(() =>
        expect(within(tplCard).getByText('Aviso de bloqueio')).toBeInTheDocument()
      )

      await user.click(within(tplCard).getByRole('button', { name: 'Editar' }))
      const nameInput = within(tplCard).getByLabelText('Nome') as HTMLInputElement
      expect(nameInput.value).toBe('Aviso de bloqueio')
      await user.clear(nameInput)
      await user.type(nameInput, 'Bloqueio externo')
      await user.click(within(tplCard).getByRole('button', { name: 'Salvar' }))
      await waitFor(() =>
        expect(api.lastPayload('templates:save')).toEqual({
          id: 1,
          name: 'Bloqueio externo',
          content: 'Estamos bloqueados por {motivo}.'
        })
      )

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      api.set('templates:list', () => ({ templates: [] }))
      await user.click(within(tplCard).getByRole('button', { name: 'Apagar' }))
      await waitFor(() => expect(api.count('templates:delete')).toBe(1))
      await waitFor(() =>
        expect(within(tplCard).getByText('Nenhum template ainda.')).toBeInTheDocument()
      )
      confirmSpy.mockRestore()
    })

    it('cancela a criação sem chamar templates:save', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      const tplCard = getCard('Templates de comentário')
      await user.click(within(tplCard).getByRole('button', { name: '+ Novo template' }))
      await user.click(within(tplCard).getByRole('button', { name: 'Cancelar' }))
      expect(api.count('templates:save')).toBe(0)
      expect(within(tplCard).getByRole('button', { name: '+ Novo template' })).toBeInTheDocument()
    })
  })

  describe('Backup', () => {
    it('exporta backup e mostra o caminho', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await user.click(screen.getByRole('button', { name: 'Exportar backup…' }))
      await waitFor(() =>
        expect(screen.getByText('Backup salvo em /Users/thiago/backup.json')).toBeInTheDocument()
      )
    })

    it('mostra erro quando exportar falha', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('backup:export', () => {
          throw new MockIpcFailure('IO_ERROR', 'Falha ao exportar backup.')
        })
      })
      await waitReady()

      await user.click(screen.getByRole('button', { name: 'Exportar backup…' }))
      await waitFor(() => expect(screen.getByText('Falha ao exportar backup.')).toBeInTheDocument())
    })

    it('importa backup após confirmação e mostra o resumo', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const api = setup()
      await waitReady()

      await user.click(screen.getByRole('button', { name: 'Importar backup…' }))
      await waitFor(() => expect(api.count('backup:import')).toBe(1))
      await waitFor(() =>
        expect(
          screen.getByText(
            'Importado: 2 notas, 3 seguidos, 1 filtros, 0 templates (preferências aplicadas)'
          )
        ).toBeInTheDocument()
      )
      confirmSpy.mockRestore()
    })

    it('não importa quando a confirmação é recusada', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const api = setup()
      await waitReady()

      await user.click(screen.getByRole('button', { name: 'Importar backup…' }))
      expect(api.count('backup:import')).toBe(0)
      confirmSpy.mockRestore()
    })
  })

  describe('Atualizações', () => {
    it('verifica, mostra versão disponível e grava/remove token', async () => {
      const user = userEvent.setup()
      const api = setup((mock) => {
        mock.set('update:check', () => ({
          current: '1.2.3',
          latest: '1.3.0',
          url: 'https://github.com/thiagopcdev/jiraiya/releases/tag/v1.3.0',
          available: true,
          tokenConfigured: false,
          error: null
        }))
      })
      await waitReady()

      const updateCard = getCard('Atualizações')
      expect(within(updateCard).getByText('Ainda não verificado nesta sessão.')).toBeInTheDocument()
      await user.click(within(updateCard).getByRole('button', { name: 'Verificar agora' }))
      await waitFor(() =>
        expect(within(updateCard).getByText(/v1.3.0 disponível/)).toBeInTheDocument()
      )

      const tokenInput = within(updateCard).getByLabelText(/Token do GitHub/)
      await user.type(tokenInput, 'ghp_abc123')
      await user.click(within(updateCard).getByRole('button', { name: 'Salvar' }))
      await waitFor(() =>
        expect(api.lastPayload('update:setToken')).toEqual({ token: 'ghp_abc123' })
      )
    })

    it('mostra mensagem de já atualizado e erro de verificação', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('update:check', () => ({
          current: '1.2.3',
          latest: null,
          url: null,
          available: false,
          tokenConfigured: false,
          error: null
        }))
      })
      await waitReady()
      await user.click(screen.getByRole('button', { name: 'Verificar agora' }))
      await waitFor(() =>
        expect(screen.getByText('Você está na versão mais recente.')).toBeInTheDocument()
      )
    })
  })

  describe('Armazenamento', () => {
    it('mostra bytes e limpa arquivos temporários', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await waitFor(() =>
        expect(screen.getByText(/Arquivos temporários de anexos: 2 KB/)).toBeInTheDocument()
      )
      await user.click(screen.getByRole('button', { name: 'Limpar' }))
      await waitFor(() => expect(screen.getByText('Liberado 2 KB')).toBeInTheDocument())
    })
  })

  describe('Sobre', () => {
    it('mostra a versão do app', async () => {
      setup()
      await waitFor(() => expect(screen.getByText('Jiraiya v1.2.3')).toBeInTheDocument())
      expect(screen.getByText('feito por @thiagopcdev')).toBeInTheDocument()
    })
  })
})
