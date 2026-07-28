// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IpcResponse } from '@shared/ipc-contract'
import { installMockApi, MockIpcFailure } from '../testing/mockApi'
import { AttachmentsSection, useMediaResolver } from './attachments'

/**
 * Anexos do card: lista (imagens em thumb + arquivos em linha), lightbox via
 * portal (abrir/fechar, salvar/abrir, tooLarge) e o resolver de mídia do ADF
 * (`useMediaResolver`) usado pela descrição/comentários.
 */

afterEach(cleanup)

function withClient(ui: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  })
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>
}

type Attachment = IpcResponse<'issues:attachments'>['attachments'][number]

const image: Attachment = {
  id: 'a1',
  filename: 'foto.png',
  mimeType: 'image/png',
  size: 2048,
  isImage: true
}
const file: Attachment = {
  id: 'a2',
  filename: 'relatorio.pdf',
  mimeType: 'application/pdf',
  size: 150_000,
  isImage: false
}

describe('AttachmentsSection', () => {
  it('não renderiza nada quando o card não tem anexos', async () => {
    installMockApi({ 'issues:attachments': () => ({ attachments: [] }) })
    const { container } = render(withClient(<AttachmentsSection issueKey="BT-1" />))
    await waitFor(() => expect(container).toBeInTheDocument())
    expect(container.textContent).toBe('')
  })

  it('lista imagens (thumb) e arquivos (linha) com a contagem no título', async () => {
    installMockApi({
      'issues:attachments': () => ({ attachments: [image, file] }),
      'issues:attachmentData': ({ variant }) => ({
        dataUri: variant === 'thumbnail' ? 'data:image/png;base64,thumb' : null,
        mimeType: 'image/png',
        tooLarge: false
      })
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    await waitFor(() => expect(screen.getByText('Anexos (2)')).toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByAltText('foto.png')).toHaveAttribute('src', 'data:image/png;base64,thumb')
    )
    expect(screen.getByText('relatorio.pdf')).toBeInTheDocument()
    expect(screen.getByText('146 KB')).toBeInTheDocument()
  })

  it('imagem sem dataUri mostra o fallback com nome do arquivo', async () => {
    installMockApi({
      'issues:attachments': () => ({ attachments: [image] }),
      'issues:attachmentData': () => ({ dataUri: null, mimeType: null, tooLarge: false })
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    await waitFor(() => expect(screen.getAllByText('foto.png').length).toBeGreaterThan(0))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('abre o lightbox ao clicar na miniatura e fecha com Escape', async () => {
    installMockApi({
      'issues:attachments': () => ({ attachments: [image] }),
      'issues:attachmentData': ({ variant }) => ({
        dataUri: `data:image/png;base64,${variant}`,
        mimeType: 'image/png',
        tooLarge: false
      })
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    const thumb = await screen.findByAltText('foto.png')
    await userEvent.click(thumb)

    await waitFor(() => expect(screen.getAllByAltText('foto.png')).toHaveLength(2))
    expect(screen.getByText('2 KB')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getAllByAltText('foto.png')).toHaveLength(1))
  })

  it('lightbox: arquivo grande demais mostra aviso em vez da imagem', async () => {
    installMockApi({
      'issues:attachments': () => ({ attachments: [image] }),
      'issues:attachmentData': ({ variant }) => ({
        dataUri: variant === 'thumbnail' ? 'data:image/png;base64,thumb' : null,
        mimeType: null,
        tooLarge: variant === 'full'
      })
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    const thumb = await screen.findByAltText('foto.png')
    await userEvent.click(thumb)

    await waitFor(() =>
      expect(screen.getByText('Arquivo grande demais para exibir.')).toBeInTheDocument()
    )
  })

  it('lightbox: salvar e abrir chamam os canais e mostram feedback', async () => {
    const api = installMockApi({
      'issues:attachments': () => ({ attachments: [image] }),
      'issues:attachmentData': () => ({
        dataUri: 'data:image/png;base64,x',
        mimeType: 'image/png',
        tooLarge: false
      }),
      'issues:attachmentSave': () => ({ saved: true, path: '/Users/thiago/Downloads/foto.png' }),
      'issues:attachmentOpen': () => ({ ok: true })
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    const thumb = await screen.findByAltText('foto.png')
    await userEvent.click(thumb)
    await waitFor(() => expect(screen.getAllByAltText('foto.png')).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: /Salvar/ }))
    await waitFor(() => expect(api.count('issues:attachmentSave')).toBe(1))
    await waitFor(() => expect(screen.getByText('Salvo em Downloads/foto.png')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Abrir/ }))
    await waitFor(() => expect(api.count('issues:attachmentOpen')).toBe(1))
  })

  it('arquivo não-imagem: salvar/abrir com erro mostra mensagem', async () => {
    installMockApi({
      'issues:attachments': () => ({ attachments: [file] }),
      'issues:attachmentSave': () => {
        throw new MockIpcFailure('SAVE_FAILED', 'Falha ao salvar')
      }
    })
    render(withClient(<AttachmentsSection issueKey="BT-1" />))

    await waitFor(() => expect(screen.getByText('relatorio.pdf')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.getByText('Falha ao salvar')).toBeInTheDocument())
  })
})

/** Componente-sonda: expõe o resolver do useMediaResolver para testar direto. */
function MediaResolverProbe({
  issueKey,
  node
}: {
  issueKey: string
  node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
}): React.JSX.Element {
  const resolve = useMediaResolver(issueKey)
  return <div data-probe>{resolve(node)}</div>
}

describe('useMediaResolver', () => {
  it('mídia externa renderiza direto pela url, sem IPC', async () => {
    const api = installMockApi({ 'issues:attachments': () => ({ attachments: [] }) })
    const { container } = render(
      withClient(
        <MediaResolverProbe
          issueKey="BT-1"
          node={{ type: 'media', attrs: { type: 'external', url: 'https://ex.com/a.png' } }}
        />
      )
    )
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://ex.com/a.png')
    )
    expect(api.count('issues:attachmentData')).toBe(0)
  })

  it('casa por alt com um anexo de imagem já listado', async () => {
    installMockApi({
      'issues:attachments': () => ({
        attachments: [image, { ...image, id: 'a3', filename: 'outra.png' }]
      }),
      'issues:attachmentData': () => ({
        dataUri: 'data:image/png;base64,x',
        mimeType: 'image/png',
        tooLarge: false
      })
    })
    render(
      withClient(
        <MediaResolverProbe
          issueKey="BT-1"
          node={{
            type: 'mediaSingle',
            content: [{ type: 'media', attrs: { alt: 'outra.png' } }]
          }}
        />
      )
    )
    await waitFor(() => expect(screen.getByAltText('outra.png')).toBeInTheDocument())
  })

  it('sem match e mais de uma imagem mostra o placeholder', async () => {
    installMockApi({
      'issues:attachments': () => ({
        attachments: [image, { ...image, id: 'a3', filename: 'outra.png' }]
      })
    })
    render(withClient(<MediaResolverProbe issueKey="BT-1" node={{ type: 'media', attrs: {} }} />))
    await waitFor(() =>
      expect(screen.getByText('[anexo — ver na lista de anexos]')).toBeInTheDocument()
    )
  })
})
