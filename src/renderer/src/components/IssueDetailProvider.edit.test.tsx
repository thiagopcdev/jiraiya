// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IpcResponse } from '@shared/ipc-contract'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import {
  baseHandlers,
  makeIssue,
  makeWorkspace,
  OpenIssueButton
} from './IssueDetailProvider.testUtils'

/**
 * Painel "Editar" (accordion): story points, prioridade, severidade,
 * estimativa original, responsável/sprint e registrar tempo. Cada campo só
 * fica dirty (e o Salvar habilita) quando muda de verdade.
 */

afterEach(cleanup)

type EditMeta = IpcResponse<'issues:editMeta'>

function makeEditMeta(overrides: Partial<EditMeta> = {}): EditMeta {
  return {
    storyPointsEditable: true,
    priority: {
      editable: true,
      current: 'Média',
      options: [
        { id: '2', name: 'Média' },
        { id: '1', name: 'Alta' }
      ]
    },
    severity: {
      fieldId: 'customfield_100',
      name: 'Severidade',
      current: 'Baixa',
      options: [
        { id: 's1', value: 'Baixa' },
        { id: 's2', value: 'Alta' }
      ]
    },
    timeSpent: '1h',
    originalEstimate: '2h',
    timeTrackingEditable: true,
    ...overrides
  }
}

async function openCardAndEditPanel(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
  await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
  const editToggles = screen.getAllByRole('button', { name: 'Editar' })
  await userEvent.click(editToggles[0])
  await waitFor(() => expect(screen.getByText('Estimativa original')).toBeInTheDocument())
}

describe('IssueDetailProvider — painel Editar', () => {
  it('abre o accordion e busca o editMeta só quando expandido', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
    await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
    expect(api.count('issues:editMeta')).toBe(0)

    await openCardAndEditPanel()
    expect(api.count('issues:editMeta')).toBe(1)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('altera story points e salva', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:update': () => ({ ok: true, queued: false })
    })
    const { container } = renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    // story points é o único <input type="number"> do painel — sem âncora de label associada
    const spInput = container.querySelector('input[type="number"]') as HTMLInputElement
    await userEvent.type(spInput, '5')
    const saveButton = screen.getByRole('button', { name: 'Salvar' })
    expect(saveButton).toBeEnabled()
    await userEvent.click(saveButton)

    await waitFor(() => expect(api.count('issues:update')).toBe(1))
    expect(api.lastPayload('issues:update')).toEqual({ key: 'BT-1', storyPoints: 5 })
  })

  it('altera prioridade e salva com priorityId/priorityName', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:update': () => ({ ok: true, queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    await userEvent.selectOptions(screen.getByDisplayValue('Média'), 'Alta')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('issues:update')).toBe(1))
    expect(api.lastPayload('issues:update')).toEqual({
      key: 'BT-1',
      priorityId: '1',
      priorityName: 'Alta'
    })
  })

  it('altera severidade e salva', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:update': () => ({ ok: true, queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    await userEvent.selectOptions(screen.getByDisplayValue('Baixa'), 'Alta')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('issues:update')).toBe(1))
    expect(api.lastPayload('issues:update')).toEqual({
      key: 'BT-1',
      severity: { fieldId: 'customfield_100', optionId: 's2' }
    })
  })

  it('altera a estimativa original e salva', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:update': () => ({ ok: true, queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    const estimateInput = screen.getByDisplayValue('2h')
    await userEvent.clear(estimateInput)
    await userEvent.type(estimateInput, '3d')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('issues:update')).toBe(1))
    expect(api.lastPayload('issues:update')).toEqual({ key: 'BT-1', originalEstimate: '3d' })
  })

  it('remove o responsável (Sem responsável) e salva', async () => {
    const issue = makeIssue({ assigneeAccountId: 'acc-other', assigneeName: 'Outra Pessoa' })
    const api = installMockApi({
      ...baseHandlers(issue),
      'auth:status': () => ({ connected: true, workspace: makeWorkspace({ accountId: 'acc-me' }) }),
      'issues:editMeta': () => makeEditMeta(),
      'issues:assignable': () => ({
        users: [{ accountId: 'acc-other', displayName: 'Outra Pessoa' }]
      }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:update': () => ({ ok: true, queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    await userEvent.selectOptions(screen.getByDisplayValue('Outra Pessoa'), 'Sem responsável')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('issues:update')).toBe(1))
    expect(api.lastPayload('issues:update')).toEqual({
      key: 'BT-1',
      assigneeAccountId: null,
      assigneeName: null
    })
  })

  it('registra tempo trabalhado e atualiza o total exibido', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta({ timeSpent: '1h', originalEstimate: null }),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:logWork': () => ({ ok: true, totalTimeSpent: '3h', queued: false })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    expect(screen.getByText('Registrado: 1h')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('1h 30m'), '2h')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() => expect(api.count('issues:logWork')).toBe(1))
    expect(api.lastPayload('issues:logWork')).toEqual({ key: 'BT-1', timeSpent: '2h' })
    await waitFor(() => expect(screen.getByText('Registrado: 3h')).toBeInTheDocument())
  })

  it('registro de tempo enfileirado offline mostra o aviso da fila', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:editMeta': () => makeEditMeta({ timeSpent: null }),
      'issues:assignable': () => ({ users: [] }),
      'sprint:moveTargets': () => ({ sprints: [] }),
      'issues:logWork': () => ({ ok: true, totalTimeSpent: null, queued: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCardAndEditPanel()

    await userEvent.type(screen.getByPlaceholderText('1h 30m'), '1h')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))

    await waitFor(() =>
      expect(
        screen.getByText('Sem rede — a ação ficou na fila e será enviada quando a conexão voltar.')
      ).toBeInTheDocument()
    )
  })
})
