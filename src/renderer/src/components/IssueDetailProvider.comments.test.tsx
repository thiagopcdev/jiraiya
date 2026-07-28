// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IpcResponse } from '@shared/ipc-contract'
import { installMockApi } from '../testing/mockApi'
import { renderWithProviders } from '../testing/render'
import { baseHandlers, makeWorkspace, OpenIssueButton } from './IssueDetailProvider.testUtils'

/**
 * Seção de comentários: listagem (ADF/fallback offline), novo comentário
 * (com rascunho automático em localStorage e colar imagem), templates,
 * editar e excluir comentário próprio.
 */

afterEach(cleanup)

type Comment = IpcResponse<'issues:comments'>['comments'][number]

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    authorAccountId: 'acc-other',
    authorName: 'Fulano',
    createdAt: '2026-07-02T12:00:00.000Z',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Oi mundo' }] }]
    },
    bodyText: 'Oi mundo',
    bodyMarkdown: 'Oi mundo',
    ...overrides
  }
}

async function openCard(issueKey = 'BT-1'): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: `abrir ${issueKey}` }))
  await waitFor(() => expect(screen.getByText('Corrigir bug no login')).toBeInTheDocument())
}

describe('IssueDetailProvider — comentários', () => {
  it('lista comentários vivos e mostra a contagem no título', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({
        comments: [
          makeComment(),
          makeComment({
            id: 'c2',
            bodyText: 'Segundo',
            body: {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Segundo comentário' }] }
              ]
            }
          })
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Oi mundo')).toBeInTheDocument())
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('sem comentários mostra o estado vazio', async () => {
    installMockApi({ ...baseHandlers(), 'issues:comments': () => ({ comments: [] }) })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Nenhum comentário ainda.')).toBeInTheDocument())
  })

  it('envia um novo comentário e limpa o textarea', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({ comments: [] }),
      'issues:comment': () => ({ ok: true, queued: false }),
      'sync:run': () => ({ started: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const textarea = screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')
    await userEvent.type(textarea, 'Feito e testado')
    await userEvent.click(screen.getByRole('button', { name: 'Comentar no Jira' }))

    await waitFor(() => expect(api.count('issues:comment')).toBe(1))
    expect(api.lastPayload('issues:comment')).toEqual({ issueKey: 'BT-1', body: 'Feito e testado' })
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('comentário enfileirado offline mostra o aviso da fila', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({ comments: [] }),
      'issues:comment': () => ({ ok: true, queued: true }),
      'sync:run': () => ({ started: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const textarea = screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')
    await userEvent.type(textarea, 'Sem rede agora')
    await userEvent.click(screen.getByRole('button', { name: 'Comentar no Jira' }))

    await waitFor(() =>
      expect(
        screen.getByText('Sem rede — a ação ficou na fila e será enviada quando a conexão voltar.')
      ).toBeInTheDocument()
    )
  })

  it('salva rascunho automaticamente e oferece restaurar/descartar ao reabrir', async () => {
    localStorage.clear()
    installMockApi({ ...baseHandlers(), 'issues:comments': () => ({ comments: [] }) })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const textarea = screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')
    await userEvent.type(textarea, 'rascunho em andamento')

    await waitFor(
      () =>
        expect(localStorage.getItem('jiraiya.draft.comment.BT-1')).toBe('rascunho em andamento'),
      { timeout: 2000 }
    )

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(screen.queryByText('Corrigir bug no login')).not.toBeInTheDocument())

    await openCard()
    await waitFor(() => expect(screen.getByText('Rascunho recuperado')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')).toHaveValue(
      'rascunho em andamento'
    )

    await userEvent.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    expect(screen.queryByText('Rascunho recuperado')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')).toHaveValue(
      ''
    )
    expect(localStorage.getItem('jiraiya.draft.comment.BT-1')).toBeNull()
  })

  it('colar uma imagem no comentário sobe como anexo e referencia o arquivo', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({ comments: [] }),
      'issues:attachmentUpload': () => ({
        attachment: {
          id: 'att-1',
          filename: 'foto.png',
          mimeType: 'image/png',
          size: 10,
          isImage: true
        }
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    const textarea = screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')
    const file = new File(['conteudo-fake'], 'foto.png', { type: 'image/png' })

    const pasteEvent = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [file] }
    })
    textarea.dispatchEvent(pasteEvent)

    await waitFor(() => expect(api.count('issues:attachmentUpload')).toBe(1))
    expect(api.lastPayload('issues:attachmentUpload')).toMatchObject({
      key: 'BT-1',
      filename: 'foto.png'
    })
    await waitFor(() => expect(textarea).toHaveValue('(anexo: foto.png)'))
  })

  it('edita um comentário próprio', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'auth:status': () => ({ connected: true, workspace: makeWorkspace({ accountId: 'acc-me' }) }),
      'issues:comments': () => ({
        comments: [makeComment({ authorAccountId: 'acc-me', bodyMarkdown: 'texto original' })]
      }),
      'issues:commentUpdate': () => ({ ok: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Oi mundo')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Editar comentário' }))

    const editArea = screen.getByDisplayValue('texto original')
    await userEvent.clear(editArea)
    await userEvent.type(editArea, 'texto corrigido')

    const commentCard = editArea.closest('div.rounded-md') as HTMLElement
    await userEvent.click(within(commentCard).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(api.count('issues:commentUpdate')).toBe(1))
    expect(api.lastPayload('issues:commentUpdate')).toEqual({
      issueKey: 'BT-1',
      commentId: 'c1',
      body: 'texto corrigido'
    })
  })

  it('exclui um comentário próprio com confirmação inline', async () => {
    const api = installMockApi({
      ...baseHandlers(),
      'auth:status': () => ({ connected: true, workspace: makeWorkspace({ accountId: 'acc-me' }) }),
      'issues:comments': () => ({ comments: [makeComment({ authorAccountId: 'acc-me' })] }),
      'issues:commentDelete': () => ({ ok: true })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() => expect(screen.getByText('Oi mundo')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Excluir comentário' }))
    expect(screen.getByText('Excluir?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    await waitFor(() => expect(api.count('issues:commentDelete')).toBe(1))
    expect(api.lastPayload('issues:commentDelete')).toEqual({ issueKey: 'BT-1', commentId: 'c1' })
  })

  it('fallback offline mostra os comentários locais quando issues:comments falha', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:comments': () => {
        throw new Error('offline')
      },
      'issues:activity': () => ({
        activities: [
          {
            id: 1,
            issueKey: 'BT-1',
            kind: 'comment',
            actorAccountId: 'acc-other',
            actorName: 'Fulano',
            field: null,
            fromValue: null,
            toValue: null,
            bodyText: 'comentário local salvo antes',
            occurredAt: '2026-07-01T09:00:00.000Z'
          }
        ]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await waitFor(() =>
      expect(screen.getByText('comentário local salvo antes')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Sem conexão com o Jira — mostrando versão local em texto simples.')
    ).toBeInTheDocument()
  })

  it('menu de templates insere o conteúdo no textarea', async () => {
    installMockApi({
      ...baseHandlers(),
      'issues:comments': () => ({ comments: [] }),
      'templates:list': () => ({
        templates: [{ id: 1, name: 'Template padrão', content: 'Conteúdo do template' }]
      })
    })
    renderWithProviders(<OpenIssueButton issueKey="BT-1" />)
    await openCard()

    await userEvent.click(screen.getByRole('button', { name: 'Templates de comentário' }))
    await waitFor(() => expect(screen.getByText('Template padrão')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Template padrão'))

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Escreva um comentário para postar no Jira…')).toHaveValue(
        'Conteúdo do template'
      )
    )
  })
})
