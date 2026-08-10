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
import { SEARCH_INDEX } from './searchIndex'

/**
 * Configurações agora é índice (9 grupos) + painel: só os cartões do grupo ATIVO
 * são renderizados. Por isso quase todo teste começa navegando com `goTo` — sem
 * isso o cartão alvo simplesmente não está no DOM. `baseHandlers` cobre o cenário
 * "tudo conectado, tudo disponível"; testes de estado alternativo (desconectado,
 * IA indisponível, gh ausente, fila com item) sobrescrevem via `api.set`.
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
    'issues:inProgressStatuses': () => ({
      statuses: [
        { status: 'Em andamento', total: 15, mine: 4 },
        { status: 'Pronto para Teste', total: 12, mine: 11 },
        { status: 'Code Review', total: 6, mine: 0 }
      ]
    }),
    'projects:list': () => ({
      projects: [
        { jiraId: '1', key: 'BT', name: 'Biud Tech', avatarUrl: null, selected: true },
        { jiraId: '2', key: 'ESG', name: 'ESG Dashboard', avatarUrl: null, selected: false }
      ]
    }),
    'projects:setSelected': () => ({ ok: true as const }),
    'sync:status': () => ({
      running: false,
      lastSuccessAt: null,
      lastError: null,
      progress: null
    }),
    'sync:run': () => ({ started: true as const }),
    'queue:list': () => ({ actions: [] }),
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

/** O rodapé do índice só aparece com o app:info resolvido — bom sinal de "tela pronta". */
async function waitReady(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Jiraiya v1.2.3')).toBeInTheDocument())
}

/** Clica num grupo do índice à esquerda. */
async function goTo(user: ReturnType<typeof userEvent.setup>, group: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: group }))
}

/** Card = faixa de título (onde mora o <h3>) + corpo; por isso dois níveis acima. */
function getCard(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title })
  return heading.parentElement?.parentElement as HTMLElement
}

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => cleanup())

  describe('Índice de grupos', () => {
    /**
     * O índice da busca casa com o cartão por igualdade de título. Renomear um
     * dos dois lados tira o cartão da busca sem erro de tipo e sem quebrar
     * nenhum outro teste — este aqui é o que transforma a divergência em falha.
     */
    it('todo cartão declarado no índice da busca existe de fato na tela', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      const rotuloDoGrupo: Record<string, string> = {
        account: 'Conta',
        sync: 'Sincronização',
        notifications: 'Notificações',
        appearance: 'Aparência',
        ai: 'Inteligência artificial',
        prs: 'Pull requests',
        templates: 'Templates',
        data: 'Dados e backup',
        updates: 'Atualizações'
      }

      for (const grupo of [...new Set(SEARCH_INDEX.map((e) => e.group))]) {
        await goTo(user, rotuloDoGrupo[grupo])
        for (const entrada of SEARCH_INDEX.filter((e) => e.group === grupo)) {
          await waitFor(() =>
            expect(screen.getByRole('heading', { name: entrada.card })).toBeInTheDocument()
          )
        }
      }
    })

    it('abre em Conta e não renderiza os cartões dos outros grupos', async () => {
      setup()
      await waitReady()

      expect(screen.getByRole('heading', { name: 'Conta' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Aparência' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Backup' })).not.toBeInTheDocument()
    })

    it('cada grupo do índice mostra os cartões que lhe pertencem', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      const casos: Array<[string, string[]]> = [
        [
          'Sincronização',
          ['Ritmo de sincronização', 'Projetos acompanhados', 'Estado da sincronização']
        ],
        ['Notificações', ['Notificações', 'Lembrete de tempo']],
        ['Aparência', ['Aparência']],
        ['Inteligência artificial', ['Inteligência artificial']],
        ['Pull requests', ['Pull requests (GitHub)']],
        ['Templates', ['Templates de comentário']],
        ['Dados e backup', ['Backup', 'Armazenamento']],
        ['Atualizações', ['Atualizações']]
      ]

      for (const [grupo, cartoes] of casos) {
        await goTo(user, grupo)
        for (const cartao of cartoes) {
          await waitFor(() =>
            expect(screen.getByRole('heading', { name: cartao })).toBeInTheDocument()
          )
        }
      }
    })

    it('marca o grupo ativo com aria-current', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      expect(screen.getByRole('button', { name: 'Conta' })).toHaveAttribute('aria-current', 'page')
      await goTo(user, 'Aparência')
      expect(screen.getByRole('button', { name: 'Aparência' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      expect(screen.getByRole('button', { name: 'Conta' })).not.toHaveAttribute('aria-current')
    })

    it('mostra versão e crédito no rodapé do índice (o antigo cartão "Sobre")', async () => {
      setup()
      await waitReady()

      expect(screen.getByText('Jiraiya v1.2.3')).toBeInTheDocument()
      expect(screen.getByText('feito por @thiagopcdev')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Sobre' })).not.toBeInTheDocument()
    })

    it('cabeçalho resume conta, site e versão', async () => {
      setup()
      await waitReady()

      await waitFor(() =>
        expect(
          screen.getByText('thiago@biud.com.br · https://biud.atlassian.net · Jiraiya v1.2.3')
        ).toBeInTheDocument()
      )
    })
  })

  describe('Busca', () => {
    it('salta para o grupo do primeiro resultado e deixa só a linha que casa', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await user.type(screen.getByLabelText('Buscar configuração'), 'densidade')

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Aparência' })).toBeInTheDocument()
      )
      expect(screen.getByLabelText('Densidade')).toBeInTheDocument()
      expect(screen.queryByLabelText('Tema')).not.toBeInTheDocument()
    })

    it('sem acento também acha, e casar pelo título mostra o cartão inteiro', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await user.type(screen.getByLabelText('Buscar configuração'), 'aparencia')

      await waitFor(() => expect(screen.getByLabelText('Tema')).toBeInTheDocument())
      expect(screen.getByLabelText('Densidade')).toBeInTheDocument()
    })

    it('esconde os cartões do grupo que não casam com a busca', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      await user.type(screen.getByLabelText('Buscar configuração'), 'fila offline')

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Estado da sincronização' })).toBeInTheDocument()
      )
      expect(
        screen.queryByRole('heading', { name: 'Ritmo de sincronização' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'Projetos acompanhados' })
      ).not.toBeInTheDocument()
    })

    it('busca sem resultado avisa e limpar volta o grupo inteiro', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()

      // change de uma vez só: digitando tecla a tecla, o 'z' isolado casaria com
      // "Armazenamento" e o salto levaria para outro grupo antes do termo completo
      fireEvent.change(screen.getByLabelText('Buscar configuração'), { target: { value: 'zzzz' } })
      await waitFor(() => expect(screen.getByText(/Nada em Conta para/)).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Conta' })).toBeInTheDocument()
      )
    })
  })

  describe('O que é trabalho em andamento', () => {
    it('no padrão, só "Em andamento" aparece marcado', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('O que é trabalho em andamento')
      await waitFor(() =>
        expect(within(card).getByRole('button', { name: /Em andamento/ })).toBeInTheDocument()
      )
      expect(within(card).getByRole('button', { name: /Em andamento/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      for (const nome of ['Pronto para Teste', 'Code Review']) {
        expect(within(card).getByRole('button', { name: new RegExp(nome) })).toHaveAttribute(
          'aria-pressed',
          'false'
        )
      }
      expect(within(card).getByText('1 de 3')).toBeInTheDocument()
    })

    it('marcar um status a mais grava a lista completa', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('O que é trabalho em andamento')
      await waitFor(() =>
        expect(within(card).getByRole('button', { name: /Code Review/ })).toBeInTheDocument()
      )
      await user.click(within(card).getByRole('button', { name: /Code Review/ }))

      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({
          inProgressStatuses: ['Em andamento', 'Code Review']
        })
      )
    })

    it('marcar todos de volta grava lista vazia — é o mesmo que "sem filtro"', async () => {
      const user = userEvent.setup()
      const api = setup((_api, prefsState) => {
        prefsState.inProgressStatuses = ['Em andamento', 'Pronto para Teste']
      })
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('O que é trabalho em andamento')
      await waitFor(() =>
        expect(within(card).getByRole('button', { name: /Code Review/ })).toHaveAttribute(
          'aria-pressed',
          'false'
        )
      )
      await user.click(within(card).getByRole('button', { name: /Code Review/ }))

      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ inProgressStatuses: [] }))
    })

    it('desmarcar o último é ignorado — deixaria a tela Hoje sem definição', async () => {
      const user = userEvent.setup()
      const api = setup((_api, prefsState) => {
        prefsState.inProgressStatuses = ['Em andamento']
      })
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('O que é trabalho em andamento')
      await waitFor(() =>
        expect(within(card).getByRole('button', { name: /Em andamento/ })).toHaveAttribute(
          'aria-pressed',
          'true'
        )
      )
      await user.click(within(card).getByRole('button', { name: /Em andamento/ }))

      expect(api.count('prefs:set')).toBe(0)
    })
  })

  describe('Conta', () => {
    it('mostra workspace conectado e desconecta', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()

      await waitFor(() =>
        expect(
          screen.getByText('Thiago Prado · thiago@biud.com.br · https://biud.atlassian.net')
        ).toBeInTheDocument()
      )

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
      await goTo(user, 'Aparência')

      await user.selectOptions(await screen.findByLabelText('Tema'), 'light')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ theme: 'light' }))
    })

    it('troca a densidade e aplica no <html> antes do round-trip', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Aparência')

      await user.selectOptions(await screen.findByLabelText('Densidade'), 'compact')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ density: 'compact' }))
      expect(document.documentElement.dataset.density).toBe('compact')
    })
  })

  describe('Notificações', () => {
    it('alterna os quatro interruptores', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Notificações')

      const toggle = async (name: RegExp, patch: Partial<Prefs>): Promise<void> => {
        await user.click(await screen.findByRole('switch', { name }))
        await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual(patch))
      }

      await toggle(/card for atribuído a mim/, { notifyAssignedToMe: false })
      await toggle(/eu for mencionado/, { notifyMentions: false })
      await toggle(/alertas críticos/, { notifyCriticalAlerts: true })
      await toggle(/daily no primeiro uso/, { morningBriefing: false })
    })

    it('lembrete de tempo: interruptor e horário', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Notificações')

      const reminder = await screen.findByRole('switch', { name: 'Lembrar de registrar tempo' })
      expect(reminder).toHaveAttribute('aria-checked', 'true')
      await user.click(reminder)
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ worklogReminder: false }))

      const timeInput = screen.getByLabelText('Horário do lembrete')
      fireEvent.change(timeInput, { target: { value: '08:00' } })
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ worklogReminderTime: '08:00' })
      )
    })
  })

  describe('Sincronização', () => {
    it('grava os quatro selects de ritmo', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      await user.selectOptions(await screen.findByLabelText('Intervalo de sincronização'), '60')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ syncIntervalMinutes: 60 }))

      await user.selectOptions(screen.getByLabelText('Janela de histórico'), '90')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ backfillDays: 90 }))

      await user.selectOptions(screen.getByLabelText('Considerar ticket parado após'), '7')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ stalledDays: 7 }))

      await user.selectOptions(screen.getByLabelText('Modo de sincronização'), 'personal')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ syncMode: 'personal' }))
    })

    it('projetos: contador bate com os chips e o clique alterna a seleção', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('Projetos acompanhados')
      expect(within(card).getByText('1 de 2')).toBeInTheDocument()
      expect(within(card).getAllByRole('button')).toHaveLength(2)

      await user.click(within(card).getByRole('button', { name: 'ESG' }))
      await waitFor(() =>
        expect(api.lastPayload('projects:setSelected')).toEqual({ keys: ['BT', 'ESG'] })
      )
    })

    it('estado da sincronização: nunca sincronizado, fila vazia e sync incremental', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      expect(await screen.findByText('nunca sincronizado')).toBeInTheDocument()
      const card = getCard('Estado da sincronização')
      expect(within(card).getByText('Ainda não sincronizado nesta máquina.')).toBeInTheDocument()
      expect(within(card).getByText('vazia')).toBeInTheDocument()

      await user.click(within(card).getByRole('button', { name: 'Sincronizar agora' }))
      await waitFor(() => expect(api.lastPayload('sync:run')).toEqual({}))
    })

    // é a sincronização completa que reconcilia o cache e remove cards excluídos
    it('"Sincronizar tudo" dispara sync completo', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      await user.click(await screen.findByRole('button', { name: 'Sincronizar tudo' }))
      await waitFor(() => expect(api.lastPayload('sync:run')).toEqual({ full: true }))
    })

    it('sync em andamento desabilita os botões e mostra o estado na faixa', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('sync:status', () => ({
          running: true,
          lastSuccessAt: null,
          lastError: null,
          progress: { phase: 'reconcile', done: 0, total: 10 }
        }))
      })
      await waitReady()
      await goTo(user, 'Sincronização')

      expect(await screen.findByText('sincronizando…')).toBeInTheDocument()
      const card = getCard('Estado da sincronização')
      // incremental e completa ficam ambas travadas enquanto um ciclo roda
      const travados = within(card).getAllByRole('button', { name: /Sincronizando…/ })
      expect(travados).toHaveLength(2)
      travados.forEach((botao) => expect(botao).toBeDisabled())
    })

    it('com última sincronização mostra a data e o erro do último ciclo', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('sync:status', () => ({
          running: false,
          lastSuccessAt: new Date().toISOString(),
          lastError: 'timeout no Jira',
          progress: null
        }))
      })
      await waitReady()
      await goTo(user, 'Sincronização')

      expect(await screen.findByText(/última agora/)).toBeInTheDocument()
      expect(screen.getByText('timeout no Jira')).toBeInTheDocument()
    })

    it('fila offline com ação pendente mostra o badge no lugar de "vazia"', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('queue:list', () => ({
          actions: [
            {
              id: 1,
              issueKey: 'BT-1',
              type: 'transition' as const,
              summary: 'Mover para Em andamento',
              status: 'pending' as const,
              attempts: 1,
              lastError: null,
              createdAt: new Date().toISOString()
            }
          ]
        }))
      })
      await waitReady()
      await goTo(user, 'Sincronização')

      const card = getCard('Estado da sincronização')
      await waitFor(() => expect(within(card).getByText('1')).toBeInTheDocument())
      expect(within(card).queryByText('vazia')).not.toBeInTheDocument()
    })

    it('registro de requisições abre o CommandLogModal (saiu do cartão de IA)', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()
      await goTo(user, 'Sincronização')

      await user.click(await screen.findByRole('button', { name: 'Abrir' }))
      await waitFor(() =>
        expect(screen.getByText('Nenhum comando registrado.')).toBeInTheDocument()
      )

      await user.click(screen.getByRole('button', { name: 'Fechar' }))
      await waitFor(() =>
        expect(screen.queryByText('Nenhum comando registrado.')).not.toBeInTheDocument()
      )
    })
  })

  describe('Pull requests (GitHub)', () => {
    it('alterna integração e edita escopo', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Pull requests')

      await user.click(await screen.findByRole('switch', { name: /Mostrar PRs relacionados/ }))
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ prIntegration: true }))

      // input controlado direto pelo valor de prefs (round-trip via invalidateQueries) —
      // digitar tecla a tecla causaria corrida com o refetch; um único change reflete
      // o mesmo onChange do componente.
      fireEvent.change(screen.getByLabelText('Escopo da busca'), {
        target: { value: 'org:biudtech' }
      })
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({ prSearchScope: 'org:biudtech' })
      )
    })

    it('mostra aviso quando gh não está disponível', async () => {
      const user = userEvent.setup()
      setup((api) => {
        api.set('prs:status', () => ({ ghAvailable: false, enabled: false }))
      })
      await waitReady()
      await goTo(user, 'Pull requests')

      await waitFor(() => expect(screen.getByText(/CLI gh não encontrado/)).toBeInTheDocument())
    })
  })

  describe('Inteligência artificial', () => {
    it('lista providers, troca o ativo e edita modelo por função', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Inteligência artificial')

      const aiCard = getCard('Inteligência artificial')
      expect(within(aiCard).getByText('/usr/local/bin/claude')).toBeInTheDocument()

      await user.selectOptions(within(aiCard).getByLabelText('Provider ativo'), 'gemini')
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ aiProvider: 'gemini' }))

      await user.selectOptions(within(aiCard).getByLabelText('Resumos (daily/weekly/1:1)'), 'opus')
      await waitFor(() =>
        expect(api.lastPayload('prefs:set')).toEqual({
          aiModels: { claude: { summaries: 'opus' } }
        })
      )
    })

    it('mostra aviso quando nenhum provider está disponível', async () => {
      const user = userEvent.setup()
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
      await waitReady()
      await goTo(user, 'Inteligência artificial')

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
      await goTo(user, 'Inteligência artificial')

      const aiCard = getCard('Inteligência artificial')
      await user.type(within(aiCard).getByLabelText('Chave da OpenRouter'), 'sk-or-teste')
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

    it('usa o ModelCombobox quando o provider ativo é openrouter', async () => {
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
      await goTo(user, 'Inteligência artificial')

      // o combobox agora é o controle da linha, então o <label> da linha o nomeia
      const combo = (await screen.findByLabelText('Resumos (daily/weekly/1:1)')) as HTMLInputElement
      await user.click(combo)
      await waitFor(() => expect(screen.getByText('GPT-4o')).toBeInTheDocument())
      await user.click(screen.getByText('GPT-4o'))

      await waitFor(() => expect(combo.value).toBe('openai/gpt-4o'))
    })
  })

  describe('Templates de comentário', () => {
    it('cria, edita e apaga um template', async () => {
      const user = userEvent.setup()
      const api = setup()
      await waitReady()
      await goTo(user, 'Templates')

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
      // contador da faixa bate com as linhas renderizadas
      expect(within(tplCard).getByText('1')).toBeInTheDocument()

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
      await goTo(user, 'Templates')

      const tplCard = getCard('Templates de comentário')
      await user.click(within(tplCard).getByRole('button', { name: '+ Novo template' }))
      await user.click(within(tplCard).getByRole('button', { name: 'Cancelar' }))
      expect(api.count('templates:save')).toBe(0)
      expect(within(tplCard).getByRole('button', { name: '+ Novo template' })).toBeInTheDocument()
    })
  })

  describe('Dados e backup', () => {
    it('exporta backup e mostra o caminho', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()
      await goTo(user, 'Dados e backup')

      await user.click(await screen.findByRole('button', { name: 'Exportar backup…' }))
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
      await goTo(user, 'Dados e backup')

      await user.click(await screen.findByRole('button', { name: 'Exportar backup…' }))
      await waitFor(() => expect(screen.getByText('Falha ao exportar backup.')).toBeInTheDocument())
    })

    it('importa backup após confirmação e mostra o resumo', async () => {
      const user = userEvent.setup()
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const api = setup()
      await waitReady()
      await goTo(user, 'Dados e backup')

      await user.click(await screen.findByRole('button', { name: 'Importar backup…' }))
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
      await goTo(user, 'Dados e backup')

      await user.click(await screen.findByRole('button', { name: 'Importar backup…' }))
      expect(api.count('backup:import')).toBe(0)
      confirmSpy.mockRestore()
    })

    it('armazenamento mostra o tamanho e limpa os temporários', async () => {
      const user = userEvent.setup()
      setup()
      await waitReady()
      await goTo(user, 'Dados e backup')

      await waitFor(() => expect(screen.getByText(/2 KB em cache/)).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Limpar' }))
      await waitFor(() => expect(screen.getByText('Liberado 2 KB')).toBeInTheDocument())
    })
  })

  describe('Atualizações', () => {
    it('verifica, mostra versão disponível e grava token', async () => {
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
      await goTo(user, 'Atualizações')

      const updateCard = getCard('Atualizações')
      expect(within(updateCard).getByText('Ainda não verificado nesta sessão.')).toBeInTheDocument()
      await user.click(within(updateCard).getByRole('button', { name: 'Verificar agora' }))
      await waitFor(() =>
        expect(within(updateCard).getByText(/v1.3.0 disponível/)).toBeInTheDocument()
      )

      await user.type(within(updateCard).getByLabelText('Token do GitHub'), 'ghp_abc123')
      await user.click(within(updateCard).getByRole('button', { name: 'Salvar' }))
      await waitFor(() =>
        expect(api.lastPayload('update:setToken')).toEqual({ token: 'ghp_abc123' })
      )
    })

    it('mostra mensagem de já atualizado e alterna o check automático', async () => {
      const user = userEvent.setup()
      const api = setup((mock) => {
        mock.set('update:check', () => ({
          current: '1.2.3',
          latest: null,
          url: null,
          available: false,
          tokenConfigured: false,
          error: null
        }))
      })
      await waitReady()
      await goTo(user, 'Atualizações')

      await user.click(await screen.findByRole('button', { name: 'Verificar agora' }))
      await waitFor(() =>
        expect(screen.getByText('Você está na versão mais recente.')).toBeInTheDocument()
      )

      await user.click(
        screen.getByRole('switch', { name: 'Verificar novas versões automaticamente' })
      )
      await waitFor(() => expect(api.lastPayload('prefs:set')).toEqual({ updateCheck: false }))
    })

    it('erro de verificação aparece na linha', async () => {
      const user = userEvent.setup()
      setup((mock) => {
        mock.set('update:check', () => ({
          current: '1.2.3',
          latest: null,
          url: null,
          available: false,
          tokenConfigured: true,
          error: 'GitHub indisponível'
        }))
      })
      await waitReady()
      await goTo(user, 'Atualizações')

      await user.click(await screen.findByRole('button', { name: 'Verificar agora' }))
      await waitFor(() => expect(screen.getByText('GitHub indisponível')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument()
    })
  })
})
