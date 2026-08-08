// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import type { Issue } from '@shared/domain'
import type { IpcResponse } from '@shared/ipc-contract'
import { installMockApi, MockIpcFailure } from '../../testing/mockApi'
import { makeQueryClient, renderWithProviders } from '../../testing/render'
import { IssueDetailContext } from '../../components/issueDetail'
import { baseHandlers } from '../../components/IssueDetailProvider.testUtils'
import { t } from '../../strings/ptBR'
import Board from './Board'
import { setSessionBoardId } from './boardSession'

type BoardData = IpcResponse<'board:view'>

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '1',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Card de exemplo',
    descriptionText: null,
    issueType: 'Story',
    status: 'A fazer',
    statusCategory: 'new',
    priority: 'Medium',
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
    url: 'https://x.atlassian.net/browse/BT-1',
    ...overrides
  }
}

function makeBoardData(overrides: Partial<BoardData> = {}): BoardData {
  return {
    board: { jiraId: 1, name: 'Board Principal', type: 'scrum', projectKey: 'BT' },
    boards: [{ jiraId: 1, name: 'Board Principal', type: 'scrum', projectKey: 'BT' }],
    sprint: { jiraId: 10, name: 'Sprint 10' },
    sprints: [
      {
        jiraId: 10,
        name: 'Sprint 10',
        state: 'active',
        startDate: '2026-01-01T12:00:00',
        endDate: '2026-01-15T12:00:00'
      }
    ],
    readOnly: false,
    columns: [
      { name: 'A Fazer', statusIds: ['1'], statusNames: ['A fazer'], issues: [] },
      { name: 'Em andamento', statusIds: ['2'], statusNames: ['Em andamento'], issues: [] },
      { name: 'Concluído', statusIds: ['3'], statusNames: ['Concluído'], issues: [] }
    ],
    unmapped: [],
    columnsSource: 'jira',
    ...overrides
  }
}

function makeDataTransfer(): DataTransfer {
  const store: Record<string, string> = {}
  return {
    setData: (fmt: string, val: string) => {
      store[fmt] = val
    },
    getData: (fmt: string) => store[fmt] ?? '',
    effectAllowed: 'all'
  } as unknown as DataTransfer
}

const noAuth = { 'auth:status': () => ({ connected: false, workspace: null }) as never }

describe('Board', () => {
  afterEach(() => {
    cleanup()
    setSessionBoardId(undefined)
  })

  it('mostra o spinner enquanto carrega', () => {
    installMockApi({ ...noAuth, 'board:view': () => new Promise(() => {}) })
    renderWithProviders(<Board />, { withIssueDetail: false })
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('estado de erro mostra a mensagem do IpcError', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () => {
        throw new MockIpcFailure('BOARD_FAIL', 'Board indisponível agora')
      }
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Board indisponível agora')).toBeInTheDocument())
  })

  it('remontar a tela reabre o último board escolhido na sessão (sem servir o cache antigo)', async () => {
    const calls: Array<number | undefined> = []
    const boards = [
      { jiraId: 1, name: 'Board Principal', type: 'scrum', projectKey: 'BT' },
      { jiraId: 2, name: 'BT - Downstream', type: 'kanban', projectKey: 'BT' }
    ]
    installMockApi({
      ...noAuth,
      'board:view': (req: { boardJiraId?: number }) => {
        calls.push(req.boardJiraId)
        const board = boards.find((b) => b.jiraId === req.boardJiraId) ?? boards[0]
        return makeBoardData(
          board.type === 'scrum' ? { board, boards } : { board, boards, sprint: null, sprints: [] }
        )
      }
    })

    // 1ª visita: abre no default (scrum) e o usuário troca para o Downstream
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toBeInTheDocument())
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '2' } })
    await waitFor(() =>
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('2')
    )
    cleanup()

    // 2ª visita (nova montagem): já pede o Downstream direto ao main
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() =>
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('2')
    )
    expect(calls[calls.length - 1]).toBe(2)
  })

  it('coluna de backlog do kanban ganha o selo "Backlog" com a explicação', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          board: { jiraId: 2, name: 'BT - Downstream', type: 'kanban', projectKey: 'BT' },
          sprint: null,
          sprints: [],
          columns: [
            {
              name: 'Lista de pendências',
              statusIds: ['1'],
              statusNames: ['A fazer'],
              issues: [],
              isBacklog: true
            },
            {
              name: 'Em andamento',
              statusIds: ['2'],
              statusNames: ['Em andamento'],
              issues: [],
              isBacklog: false
            }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })

    await waitFor(() => expect(screen.getByText('Lista de pendências')).toBeInTheDocument())
    const badge = screen.getByText('Backlog')
    expect(badge).toHaveAttribute('title', t.board.backlogHint)
    // colunas comuns não ganham o selo
    expect(screen.getAllByText('Backlog')).toHaveLength(1)
  })

  describe('badge de limite de WIP', () => {
    it('coluna sem wipMax não mostra badge', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())
      expect(screen.queryByText(t.board.wipLimit(1, 2))).not.toBeInTheDocument()
    })

    it('coluna com wipMax dentro do limite mostra o badge em âmbar', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              { name: 'A Fazer', statusIds: ['1'], statusNames: [], issues: [] },
              {
                name: 'Em andamento',
                statusIds: ['2'],
                statusNames: [],
                wipMax: 2,
                issues: [makeIssue({ key: 'BT-1' }), makeIssue({ key: 'BT-2' })]
              },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      const badge = await screen.findByText(t.board.wipLimit(2, 2))
      expect(badge.className).toContain('rounded-full')
      expect(badge.className).toContain('bg-amber-600/16')
      expect(badge.className).toContain('text-amber-400')
    })

    it('coluna com contagem acima do wipMax mostra o badge em vermelho (estouro)', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              { name: 'A Fazer', statusIds: ['1'], statusNames: [], issues: [] },
              {
                name: 'Em andamento',
                statusIds: ['2'],
                statusNames: [],
                wipMax: 2,
                issues: [
                  makeIssue({ key: 'BT-1' }),
                  makeIssue({ key: 'BT-2' }),
                  makeIssue({ key: 'BT-3' })
                ]
              },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      const badge = await screen.findByText(t.board.wipLimit(3, 2))
      expect(badge.className).toContain('bg-red-600/16')
      expect(badge.className).toContain('text-red-400')
    })
  })

  it('renderiza colunas com issues, contagem e soma de story points', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          columns: [
            {
              name: 'A Fazer',
              statusIds: ['1'],
              statusNames: ['A fazer'],
              issues: [
                makeIssue({ key: 'BT-1', summary: 'Primeira', storyPoints: 3 }),
                makeIssue({ key: 'BT-2', summary: 'Segunda', storyPoints: 2 })
              ]
            },
            { name: 'Em andamento', statusIds: ['2'], statusNames: ['Em andamento'], issues: [] },
            { name: 'Concluído', statusIds: ['3'], statusNames: ['Concluído'], issues: [] }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Primeira')).toBeInTheDocument())
    expect(screen.getByText('Segunda')).toBeInTheDocument()
    // formato vem de t.board.columnSummary — não hardcoda o "·" pra não descolar do contrato
    expect(screen.getByText(t.board.columnSummary(2, 5))).toBeInTheDocument()
    expect(screen.getAllByText('Nenhum card nesta coluna.')).toHaveLength(2)
  })

  it('colunas usam largura fluida (B1: flex-1 com piso de 236px, sem largura fixa)', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          columns: [
            {
              name: 'A Fazer',
              statusIds: ['1'],
              statusNames: [],
              issues: [makeIssue({ key: 'BT-1', summary: 'Card fluido' })]
            },
            { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
            { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Card fluido')).toBeInTheDocument())

    const column = screen.getByText('A Fazer').closest('div')!.parentElement!
    expect(column.className).toContain('flex-1')
    expect(column.className).toContain('basis-[236px]')
    expect(column.className).toContain('min-w-[236px]')
    expect(column.className).not.toContain('w-72')
    // o container das colunas mantém a rolagem horizontal
    expect(column.parentElement?.className).toContain('overflow-x-auto')
  })

  it('calha da coluna é painel in-flow (bg-zinc-800/60, sem sombra) e o piso de 236px vale com o padding', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          columns: [
            {
              name: 'A Fazer',
              statusIds: ['1'],
              statusNames: [],
              issues: [makeIssue({ key: 'BT-1', summary: 'Card na calha' })]
            },
            { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
            { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Card na calha')).toBeInTheDocument())

    const column = screen.getByText('A Fazer').closest('div')!.parentElement!
    expect(column.className).toContain('rounded-lg')
    expect(column.className).toContain('bg-zinc-800/60')
    expect(column.className).toContain('p-2')
    // painel in-flow não leva a sombra de cartão
    expect(column.className).not.toContain('shadow-card')
    // nada furando o box-sizing do preflight (o piso conta o padding)
    expect(column.getAttribute('style')).toBeNull()
  })

  describe('pele do card do quadro', () => {
    function withCards(): void {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [
                  makeIssue({ key: 'BT-1', summary: 'Cartão a fazer', statusCategory: 'new' })
                ]
              },
              {
                name: 'Em andamento',
                statusIds: ['2'],
                statusNames: [],
                issues: [
                  makeIssue({
                    key: 'BT-2',
                    summary: 'Cartão em andamento',
                    statusCategory: 'indeterminate'
                  })
                ]
              },
              {
                name: 'Concluído',
                statusIds: ['3'],
                statusNames: [],
                issues: [
                  makeIssue({ key: 'BT-3', summary: 'Cartão concluído', statusCategory: 'done' })
                ]
              }
            ]
          })
      })
    }

    const cardOf = (summary: string): HTMLElement =>
      screen.getByText(summary).closest('div[draggable]') as HTMLElement

    it('acento de 3px na borda esquerda por categoria de status', async () => {
      withCards()
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Cartão a fazer')).toBeInTheDocument())

      expect(cardOf('Cartão a fazer').className).toContain('border-l-zinc-700')
      expect(cardOf('Cartão em andamento').className).toContain('border-l-indigo-600')
      expect(cardOf('Cartão concluído').className).toContain('border-l-green-600')
      // superfície sólida com sombra de 1px e o acento de 3px
      expect(cardOf('Cartão a fazer').className).toContain('bg-zinc-900')
      expect(cardOf('Cartão a fazer').className).toContain('shadow-card')
      expect(cardOf('Cartão a fazer').className).toContain('border-l-[3px]')
    })

    it('sem card aberto nenhum cartão fica selecionado', async () => {
      withCards()
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Cartão a fazer')).toBeInTheDocument())

      expect(cardOf('Cartão a fazer').className).toContain('border-zinc-800')
      expect(cardOf('Cartão a fazer').className).not.toContain('ring-2')
    })
  })

  it('cabeçalho usa ScreenHeader com o título e o contexto de board/sprint/cards/sp restantes', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          board: { jiraId: 1, name: 'Board Principal', type: 'scrum', projectKey: 'BT' },
          columns: [
            {
              name: 'A Fazer',
              statusIds: ['1'],
              statusNames: [],
              issues: [
                makeIssue({ key: 'BT-1', storyPoints: 3, statusCategory: 'new' }),
                makeIssue({ key: 'BT-2', storyPoints: 2, statusCategory: 'indeterminate' })
              ]
            },
            { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
            {
              name: 'Concluído',
              statusIds: ['3'],
              statusNames: [],
              issues: [makeIssue({ key: 'BT-3', storyPoints: 5, statusCategory: 'done' })]
            }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })

    const expectedContext = t.board.context('Board Principal', 'Sprint 10 (ativa)', 3, 5)
    await waitFor(() => expect(screen.getByText(expectedContext)).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: t.board.title })).toBeInTheDocument()
  })

  it('mostra o seletor de board quando há mais de um e o de sprint pra board scrum', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({
          boards: [
            { jiraId: 1, name: 'Board Principal', type: 'scrum', projectKey: 'BT' },
            { jiraId: 2, name: 'Board Secundário', type: 'scrum', projectKey: 'BT' }
          ]
        })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Board Principal' })).toBeInTheDocument()
    )
    expect(screen.getByRole('option', { name: 'Board Secundário' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sprint 10 (ativa)' })).toBeInTheDocument()
  })

  it('badge de somente leitura e banner de fallback aparecem quando aplicável', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () => makeBoardData({ readOnly: true, columnsSource: 'fallback' })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() =>
      expect(screen.getByText('Sprint encerrada — somente leitura')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Colunas aproximadas (configuração do board indisponível)')
    ).toBeInTheDocument()
  })

  it('sem sprint ativa (scrum) mostra o empty state específico', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () => makeBoardData({ sprint: null })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Sem sprint ativa')).toBeInTheDocument())
  })

  it('coluna "fora do quadro" só aparece quando há issues não mapeadas (após filtro)', async () => {
    installMockApi({
      ...noAuth,
      'board:view': () =>
        makeBoardData({ unmapped: [makeIssue({ key: 'BT-9', summary: 'Sem coluna' })] })
    })
    renderWithProviders(<Board />, { withIssueDetail: false })
    await waitFor(() => expect(screen.getByText('Fora do quadro')).toBeInTheDocument())
    expect(screen.getByText('Sem coluna')).toBeInTheDocument()
  })

  describe('filtro de responsável', () => {
    it('sem usuário autenticado, o padrão é "Todos" e mostra todo mundo', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: ['A fazer'],
                issues: [
                  makeIssue({ key: 'BT-1', assigneeAccountId: 'acc-1', assigneeName: 'Ana' }),
                  makeIssue({ key: 'BT-2', assigneeAccountId: 'acc-2', assigneeName: 'Bruno' })
                ]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())
      expect(screen.getByText('BT-2')).toBeInTheDocument()
      expect(screen.getAllByTitle('Ana').length).toBeGreaterThan(0)
      expect(screen.getAllByTitle('Bruno').length).toBeGreaterThan(0)
    })

    it('com usuário autenticado que tem cards, filtra por padrão só os dele; alternar chip muda o filtro', async () => {
      installMockApi({
        'auth:status': () => ({
          connected: true,
          workspace: {
            id: 1,
            siteUrl: 'https://x.atlassian.net',
            email: 'ana@x.com',
            accountId: 'acc-1',
            displayName: 'Ana',
            timeZone: null
          }
        }),
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [
                  makeIssue({ key: 'BT-1', assigneeAccountId: 'acc-1', assigneeName: 'Ana' }),
                  makeIssue({ key: 'BT-2', assigneeAccountId: 'acc-2', assigneeName: 'Bruno' })
                ]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      const user = userEvent.setup()
      renderWithProviders(<Board />, { withIssueDetail: false })

      await waitFor(() => expect(screen.getByText('BT-1')).toBeInTheDocument())
      expect(screen.queryByText('BT-2')).not.toBeInTheDocument()

      await user.click(screen.getByText('Todos'))
      expect(screen.getByText('BT-2')).toBeInTheDocument()

      // a partir de "Todos" (filtro vazio), religar o chip da Ana volta a restringir só a ela
      await user.click(screen.getByTitle('Ana (você)'))
      expect(screen.getByText('BT-1')).toBeInTheDocument()
      expect(screen.queryByText('BT-2')).not.toBeInTheDocument()
    })
  })

  describe('drag & drop', () => {
    it('arrastar um card pra outra coluna chama board:move com os statusIds de destino', async () => {
      const api = installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1', summary: 'Mover-me' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          }),
        'board:move': () => ({ newStatus: 'Em andamento', newStatusCategory: 'indeterminate' })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Mover-me')).toBeInTheDocument())

      const card = screen.getByText('Mover-me').closest('div[draggable]')!
      const targetColumnTitle = screen.getByText('Em andamento')
      const targetColumn = targetColumnTitle.closest('div')!.parentElement!

      const dt = makeDataTransfer()
      fireEvent.dragStart(card, { dataTransfer: dt })
      fireEvent.drop(targetColumn, { dataTransfer: dt })

      await waitFor(() => expect(api.count('board:move')).toBe(1))
      expect(api.lastPayload('board:move')).toEqual({
        issueKey: 'BT-1',
        targetStatusIds: ['2'],
        targetColumnName: 'Em andamento'
      })
    })

    it('soltar na mesma coluna de origem não dispara board:move', async () => {
      const api = installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1', summary: 'Fico aqui' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Fico aqui')).toBeInTheDocument())

      const card = screen.getByText('Fico aqui').closest('div[draggable]')!
      const originColumnTitle = screen.getByText('A Fazer')
      const originColumn = originColumnTitle.closest('div')!.parentElement!

      const dt = makeDataTransfer()
      fireEvent.dragStart(card, { dataTransfer: dt })
      fireEvent.drop(originColumn, { dataTransfer: dt })

      expect(api.count('board:move')).toBe(0)
    })

    it('board somente leitura desabilita o arraste dos cards', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            readOnly: true,
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1', summary: 'Travado' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Travado')).toBeInTheDocument())
      const card = screen.getByText('Travado').closest('div[draggable]')!
      expect(card).toHaveAttribute('draggable', 'false')
    })

    it('erro no board:move reverte o otimista e mostra a mensagem por um tempo', async () => {
      const api = installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1', summary: 'Vai falhar' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          }),
        'board:move': () => {
          throw new MockIpcFailure('MOVE_FAIL', 'Não foi possível mover o card')
        }
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Vai falhar')).toBeInTheDocument())

      const card = screen.getByText('Vai falhar').closest('div[draggable]')!
      const targetColumnTitle = screen.getByText('Em andamento')
      const targetColumn = targetColumnTitle.closest('div')!.parentElement!

      const dt = makeDataTransfer()
      fireEvent.dragStart(card, { dataTransfer: dt })
      fireEvent.drop(targetColumn, { dataTransfer: dt })

      await waitFor(() =>
        expect(screen.getByText('Não foi possível mover o card')).toBeInTheDocument()
      )
      expect(api.count('board:move')).toBe(1)
    })

    // BT-907: mover card excluído no Jira devolvia 404 e o card voltava pra
    // coluna; agora ele já saiu do cache do main e não deve piscar de volta
    it('ISSUE_GONE explica e não devolve o card à coluna de origem', async () => {
      let issues = [makeIssue({ key: 'BT-907', summary: 'Card fantasma' })]
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              { name: 'A Fazer', statusIds: ['1'], statusNames: [], issues },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          }),
        'board:move': () => {
          // o main purga o card antes de responder: o refetch não o traz mais
          issues = []
          throw new MockIpcFailure('ISSUE_GONE', 'BT-907 não existe mais no Jira')
        }
      })
      renderWithProviders(<Board />, { withIssueDetail: false })
      await waitFor(() => expect(screen.getByText('Card fantasma')).toBeInTheDocument())

      const card = screen.getByText('Card fantasma').closest('div[draggable]')!
      const targetColumn = screen.getByText('Em andamento').closest('div')!.parentElement!
      const dt = makeDataTransfer()
      fireEvent.dragStart(card, { dataTransfer: dt })
      fireEvent.drop(targetColumn, { dataTransfer: dt })

      await waitFor(() =>
        expect(screen.getByText('BT-907 não existe mais no Jira')).toBeInTheDocument()
      )
      await waitFor(() => expect(screen.queryByText('Card fantasma')).not.toBeInTheDocument())
    })

    it('clicar num card (sem arrastar) abre a gaveta com a key certa', async () => {
      installMockApi({
        ...noAuth,
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-7', summary: 'Clique aqui' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      const openIssue = vi.fn()
      const user = userEvent.setup()
      const client = makeQueryClient()
      render(
        <QueryClientProvider client={client}>
          <IssueDetailContext.Provider value={{ openIssue, close: vi.fn() }}>
            <Board />
          </IssueDetailContext.Provider>
        </QueryClientProvider>
      )
      await waitFor(() => expect(screen.getByText('Clique aqui')).toBeInTheDocument())
      await user.click(screen.getByText('Clique aqui'))
      expect(openIssue).toHaveBeenCalledWith('BT-7')
    })
  })

  describe('painel docado (B3)', () => {
    // o provider só doca acima de 1100px (handoff regra 2); o stub global de
    // matchMedia (testing/setup.ts) sempre devolve matches:false, então aqui
    // forçamos a faixa larga pra exercitar o caminho docado de verdade.
    const realMatchMedia = window.matchMedia
    beforeEach(() => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes('1100'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      })) as unknown as typeof window.matchMedia
    })
    afterEach(() => {
      window.matchMedia = realMatchMedia
    })

    it('abrir um card pelo quadro monta o painel docado como irmão das colunas, sem overlay', async () => {
      installMockApi({
        ...baseHandlers(),
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [makeIssue({ key: 'BT-1', summary: 'Card docável' })]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />)
      await waitFor(() => expect(screen.getByText('Card docável')).toBeInTheDocument())

      await userEvent.click(screen.getByText('Card docável'))

      // o painel docado abriu (separador de redimensionar só existe nele)
      const handle = await screen.findByRole('separator', { name: t.detail.resizeHandle })
      // sem overlay sobreposto: o provider suprime a gaveta enquanto o docado está montado
      expect(document.querySelector('.fixed.inset-0')).toBeNull()

      // irmão direto do container de colunas: mesmo pai, dentro da linha cheia
      const columnsRow = screen.getByText('A Fazer').closest('div')!
        .parentElement! // coluna
      .parentElement! // linha "flex gap-3 overflow-x-auto" das colunas
      const contentWrapper = columnsRow.parentElement! // wrapper com padding/scroll vertical
      const dockedRoot = handle.parentElement!
      expect(dockedRoot.parentElement).toBe(contentWrapper.parentElement)
    })

    it('o card aberto no painel fica marcado como selecionado no quadro', async () => {
      installMockApi({
        ...baseHandlers(),
        'board:view': () =>
          makeBoardData({
            columns: [
              {
                name: 'A Fazer',
                statusIds: ['1'],
                statusNames: [],
                issues: [
                  makeIssue({ key: 'BT-1', summary: 'Card selecionado' }),
                  makeIssue({ key: 'BT-2', summary: 'Card vizinho' })
                ]
              },
              { name: 'Em andamento', statusIds: ['2'], statusNames: [], issues: [] },
              { name: 'Concluído', statusIds: ['3'], statusNames: [], issues: [] }
            ]
          })
      })
      renderWithProviders(<Board />)
      await waitFor(() => expect(screen.getByText('Card selecionado')).toBeInTheDocument())

      await userEvent.click(screen.getByText('Card selecionado'))
      await screen.findByRole('separator', { name: t.detail.resizeHandle })

      const selected = screen.getByText('Card selecionado').closest('div[draggable]')!
      const other = screen.getByText('Card vizinho').closest('div[draggable]')!
      expect(selected.className).toContain('border-indigo-600/60')
      expect(selected.className).toContain('ring-2')
      expect(other.className).toContain('border-zinc-800')
      expect(other.className).not.toContain('ring-2')
    })
  })
})
