// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, OpenIssueButton } from './IssueDetailProvider.testUtils'
import { useIssueDetail } from './issueDetail'

/**
 * Abas da área de atividade (Comentários / Histórico / Worklogs / PRs) e a
 * posição do composer: rolando com o corpo na gaveta, ancorado no rodapé no
 * painel docado.
 */

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
})

/** matchMedia sempre largo: os testes de docado precisam de `(min-width: 1100px)`. */
const realMatchMedia = window.matchMedia

function stubWideWindow(): void {
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
}

afterEach(() => {
  window.matchMedia = realMatchMedia
})

/** Faz o papel do Quadro: monta o host docado ao lado do resto da tela. */
function BoardLike(): React.JSX.Element {
  const { DockedPanel } = useIssueDetail()
  const [mounted] = useState(true)
  return (
    <div>
      <OpenIssueButton issueKey="BT-1" />
      {mounted && <DockedPanel />}
    </div>
  )
}

async function openCard(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))
  await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
}

function commentComposer(): HTMLElement {
  return screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')
}

const changelogHandlers = {
  'issues:changelog': () => ({
    entries: [
      {
        id: 'ch1',
        authorName: 'Fulano',
        createdAt: '2026-07-01T09:00:00.000Z',
        items: [{ field: 'status', from: 'A fazer', to: 'Em andamento' }]
      }
    ]
  })
}

describe('IssueDetailProvider — abas do card', () => {
  it('abre em Comentários e mostra a contagem na própria aba', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({
        comments: [
          {
            id: 'c1',
            authorAccountId: 'acc-other',
            authorName: 'Fulano',
            createdAt: '2026-07-02T12:00:00.000Z',
            body: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Oi mundo' }] }]
            },
            bodyText: 'Oi mundo',
            bodyMarkdown: 'Oi mundo'
          }
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Oi mundo')).toBeInTheDocument())
    const commentsTab = screen.getByRole('button', { name: /Comentários/ })
    expect(within(commentsTab).getByText('1')).toBeInTheDocument()
    // aba ativa no padrão sublinhado do PairTabs
    expect(commentsTab.className).toContain('border-indigo-500')
    expect(commentsTab.className).toContain('text-indigo-400')
    expect(commentsTab.className).toContain('font-semibold')
  })

  it('trocar de aba troca o conteúdo: Histórico esconde os comentários', async () => {
    installMockApi({
      ...baseHandlers(),
      ...changelogHandlers,
      'issues:comments': () => ({ comments: [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(screen.getByText('Nenhum comentário ainda.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }))
    await waitFor(() => expect(screen.getByText('status')).toBeInTheDocument())
    expect(screen.queryByText('Nenhum comentário ainda.')).not.toBeInTheDocument()

    // e voltar para Comentários esconde o histórico
    await userEvent.click(screen.getByRole('button', { name: /Comentários/ }))
    await waitFor(() => expect(screen.getByText('Nenhum comentário ainda.')).toBeInTheDocument())
    expect(screen.queryByText('status')).not.toBeInTheDocument()
  })

  it('o changelog não é buscado antes de a aba Histórico abrir', async () => {
    const api = installMockApi({ ...baseHandlers(), ...changelogHandlers })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    // abrir outras abas não dispara o changelog
    await userEvent.click(screen.getByRole('button', { name: 'Worklogs' }))
    expect(api.count('issues:changelog')).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }))
    await waitFor(() => expect(api.count('issues:changelog')).toBe(1))
  })

  it('a aba ativa fica sublinhada e as demais em zinc-400', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Histórico' }))
    const history = screen.getByRole('button', { name: 'Histórico' })
    const worklogs = screen.getByRole('button', { name: 'Worklogs' })
    expect(history.className).toContain('border-indigo-500')
    expect(worklogs.className).toContain('text-zinc-400')
    expect(worklogs.className).toContain('border-transparent')
  })

  it('a aba de PRs aparece e mostra os PRs sem título de seção próprio', async () => {
    installMockApi({
      ...baseHandlers(),
      'prs:status': () => ({ ghAvailable: true, enabled: true }),
      'prs:forIssue': () => ({
        available: true,
        prs: [
          {
            repo: 'biudtech/biud-frontend',
            number: 42,
            title: 'Corrige bug do login',
            url: 'https://github.com/biudtech/biud-frontend/pull/42',
            state: 'open' as const,
            isDraft: false,
            reviewDecision: 'APPROVED' as const,
            checks: 'passing' as const,
            updatedAt: '2026-07-01T10:00:00.000Z'
          }
        ]
      }),
      'issues:comments': () => ({ comments: [] })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    // a lista de PRs não vaza para a aba de Comentários
    expect(screen.queryByText(/Corrige bug do login/)).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: /^PRs/ })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^PRs/ }))

    expect(screen.getByText(/Corrige bug do login/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhum comentário ainda.')).not.toBeInTheDocument()
  })
})

describe('IssueDetailProvider — posição do composer', () => {
  it('na gaveta o composer rola junto com o corpo', async () => {
    installMockApi(baseHandlers())
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    expect(commentComposer().closest('.overflow-y-auto')).not.toBeNull()
  })

  it('no docado o composer fica no rodapé, fora da área rolável', async () => {
    stubWideWindow()
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    const textarea = commentComposer()
    expect(textarea.closest('.overflow-y-auto')).toBeNull()

    const footer = textarea.closest('div.border-t') as HTMLElement
    expect(footer.className).toContain('border-zinc-800')
    expect(footer.className).toContain('bg-zinc-950/60')

    // o composer inteiro foi junto: abas Editar/Prévia e "Estruturar com IA"
    expect(within(footer).getByRole('button', { name: 'Prévia' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Estruturar com IA' })).toBeInTheDocument()
  })

  it('no docado o aviso de rascunho recuperado aparece no rodapé', async () => {
    stubWideWindow()
    localStorage.setItem('jiraiya.draft.comment.BT-1', 'rascunho de ontem')
    installMockApi(baseHandlers())
    renderWithProviders(<BoardLike />)
    await openCard()

    const footer = commentComposer().closest('div.border-t') as HTMLElement
    expect(within(footer).getByText('Rascunho recuperado')).toBeInTheDocument()
    expect(commentComposer()).toHaveValue('rascunho de ontem')
  })

  it('no docado o card não sincronizado não mostra composer nenhum', async () => {
    stubWideWindow()
    installMockApi({ ...baseHandlers(), 'issues:get': () => ({ issue: null }) })
    renderWithProviders(<BoardLike />)
    await userEvent.click(screen.getByRole('button', { name: 'abrir BT-1' }))

    await waitFor(() =>
      expect(
        screen.getByText(
          'Este card não está aqui: ainda não sincronizou ou não existe mais no Jira.'
        )
      ).toBeInTheDocument()
    )
    expect(
      screen.queryByPlaceholderText('Escreva um comentário para postar no Jira…')
    ).not.toBeInTheDocument()
  })
})
