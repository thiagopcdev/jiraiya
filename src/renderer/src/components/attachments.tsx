import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, FileImage, Paperclip, X } from 'lucide-react'
import type { IpcResponse } from '@shared/ipc-contract'
import { invoke, IpcError } from '../api/client'
import { Button, Spinner } from './ui'

/**
 * Componentes de anexos do card: seção da gaveta (`AttachmentsSection`) e o
 * resolver usado pelo `AdfView` para renderizar imagens embutidas na descrição
 * e nos comentários (`useMediaResolver`). Os dois compartilham a mesma query
 * de listagem (`['issue-attachments', issueKey]`) — o Jira não expõe o
 * binário por outro caminho, então tudo passa por `issues:attachmentData`.
 */

type Attachment = IpcResponse<'issues:attachments'>['attachments'][number]

function useAttachmentsQuery(
  issueKey: string
): ReturnType<typeof useQuery<IpcResponse<'issues:attachments'>>> {
  return useQuery({
    queryKey: ['issue-attachments', issueKey],
    queryFn: () => invoke('issues:attachments', { key: issueKey }),
    staleTime: 60_000,
    retry: 0
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Reduz um path absoluto aos últimos 2 segmentos, só pra caber na mensagem de sucesso. */
function shortenPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/')
}

/** Miniatura de um anexo de imagem. Loading → placeholder; erro → ícone + nome; ok → thumbnail clicável. */
function AttachmentImage({
  attachmentId,
  filename,
  onExpand
}: {
  attachmentId: string
  filename: string
  onExpand: () => void
}): React.JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attachment-thumb', attachmentId],
    queryFn: () => invoke('issues:attachmentData', { attachmentId, variant: 'thumbnail' }),
    staleTime: Infinity,
    retry: 0
  })

  if (isLoading) {
    return <div className="h-24 w-24 animate-pulse rounded-md bg-zinc-900" />
  }

  if (isError || !data?.dataUri) {
    return (
      <div
        className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 p-1.5 text-center"
        title={filename}
      >
        <FileImage size={18} className="text-zinc-600" />
        <span className="line-clamp-2 text-[10px] leading-tight text-zinc-600">{filename}</span>
      </div>
    )
  }

  return (
    <img
      src={data.dataUri}
      alt={filename}
      className="max-h-40 cursor-zoom-in rounded-md border border-zinc-800"
      onClick={onExpand}
    />
  )
}

/**
 * Overlay em tela cheia com a imagem em tamanho real. Registra o Escape em
 * capture + stopPropagation pra fechar só o lightbox — a gaveta também escuta
 * Escape (em bubble, sem capture) pra navegar/fechar, e não deve reagir aqui.
 */
function AttachmentLightbox({
  attachmentId,
  filename,
  size,
  onClose
}: {
  attachmentId: string
  filename: string
  size: number
  onClose: () => void
}): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['attachment-full', attachmentId],
    queryFn: () => invoke('issues:attachmentData', { attachmentId, variant: 'full' }),
    staleTime: Infinity,
    retry: 0
  })

  const [saveBusy, setSaveBusy] = useState(false)
  const [openBusy, setOpenBusy] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const handleSave = async (): Promise<void> => {
    setSaveBusy(true)
    setError(null)
    try {
      const res = await invoke('issues:attachmentSave', { attachmentId, filename })
      if (res.saved && res.path) {
        setSavedMsg(`Salvo em ${shortenPath(res.path)}`)
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Erro ao salvar o anexo.')
    } finally {
      setSaveBusy(false)
    }
  }

  const handleOpen = async (): Promise<void> => {
    setOpenBusy(true)
    setError(null)
    try {
      await invoke('issues:attachmentOpen', { attachmentId, filename })
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Erro ao abrir o anexo.')
    } finally {
      setOpenBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black/80 p-6"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 rounded-md p-1.5 text-zinc-300 hover:bg-white/10"
        onClick={onClose}
        aria-label="Fechar"
      >
        <X size={18} />
      </button>

      {isLoading ? (
        <Spinner className="text-zinc-300" />
      ) : data?.tooLarge ? (
        <p className="text-sm text-zinc-300">Arquivo grande demais para exibir.</p>
      ) : data?.dataUri ? (
        <img
          src={data.dataUri}
          alt={filename}
          className="max-h-[85vh] max-w-[90vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <p className="text-sm text-amber-400">Não foi possível carregar o anexo.</p>
      )}

      <div
        className="flex w-full max-w-2xl items-center justify-between gap-3 rounded-md bg-zinc-900/90 px-3 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-200">{filename}</p>
          <p className="text-xs text-zinc-500">
            {formatSize(size)}
            {savedMsg && <span className="ml-2 text-green-400">{savedMsg}</span>}
            {error && <span className="ml-2 text-amber-400">{error}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" disabled={saveBusy} onClick={() => void handleSave()}>
            {saveBusy ? <Spinner /> : <Download size={14} />}
            Salvar
          </Button>
          <Button variant="secondary" disabled={openBusy} onClick={() => void handleOpen()}>
            {openBusy ? <Spinner /> : <ExternalLink size={14} />}
            Abrir
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Linha de anexo não-imagem: ícone, nome, tamanho e ações salvar/abrir (busy por item). */
function AttachmentRow({ attachment }: { attachment: Attachment }): React.JSX.Element {
  const [busyAction, setBusyAction] = useState<'save' | 'open' | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async (): Promise<void> => {
    setBusyAction('save')
    setError(null)
    try {
      const res = await invoke('issues:attachmentSave', {
        attachmentId: attachment.id,
        filename: attachment.filename
      })
      if (res.saved && res.path) {
        setSavedMsg(`Salvo em ${shortenPath(res.path)}`)
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Erro ao salvar o anexo.')
    } finally {
      setBusyAction(null)
    }
  }

  const handleOpen = async (): Promise<void> => {
    setBusyAction('open')
    setError(null)
    try {
      await invoke('issues:attachmentOpen', {
        attachmentId: attachment.id,
        filename: attachment.filename
      })
    } catch (err) {
      setError(err instanceof IpcError ? err.message : 'Erro ao abrir o anexo.')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <Paperclip size={14} className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate text-zinc-300" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="shrink-0 text-xs text-zinc-600">{formatSize(attachment.size)}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            disabled={busyAction !== null}
            title="Salvar"
            aria-label="Salvar"
            onClick={() => void handleSave()}
          >
            {busyAction === 'save' ? <Spinner /> : <Download size={14} />}
          </button>
          <button
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            disabled={busyAction !== null}
            title="Abrir"
            aria-label="Abrir"
            onClick={() => void handleOpen()}
          >
            {busyAction === 'open' ? <Spinner /> : <ExternalLink size={14} />}
          </button>
        </div>
      </div>
      {(savedMsg || error) && (
        <p className={`mt-1 text-xs ${error ? 'text-amber-400' : 'text-green-400'}`}>
          {error ?? savedMsg}
        </p>
      )}
    </div>
  )
}

export function AttachmentsSection({ issueKey }: { issueKey: string }): React.JSX.Element | null {
  const { data } = useAttachmentsQuery(issueKey)
  const [lightbox, setLightbox] = useState<{ id: string; filename: string; size: number } | null>(
    null
  )

  if (!data || data.attachments.length === 0) return null

  const images = data.attachments.filter((a) => a.isImage)
  const files = data.attachments.filter((a) => !a.isImage)

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Anexos ({data.attachments.length})
      </h3>
      <div className="space-y-2">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((a) => (
              <AttachmentImage
                key={a.id}
                attachmentId={a.id}
                filename={a.filename}
                onExpand={() => setLightbox({ id: a.id, filename: a.filename, size: a.size })}
              />
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-1">
            {files.map((a) => (
              <AttachmentRow key={a.id} attachment={a} />
            ))}
          </div>
        )}
      </div>
      {lightbox && (
        <AttachmentLightbox
          attachmentId={lightbox.id}
          filename={lightbox.filename}
          size={lightbox.size}
          onClose={() => setLightbox(null)}
        />
      )}
    </section>
  )
}

/** Imagem resolvida dentro do ADF (descrição/comentários): thumbnail com lightbox próprio. */
function ResolvedMediaImage({
  attachmentId,
  filename,
  size
}: {
  attachmentId: string
  filename: string
  size: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <AttachmentImage
        attachmentId={attachmentId}
        filename={filename}
        onExpand={() => setOpen(true)}
      />
      {open && (
        <AttachmentLightbox
          attachmentId={attachmentId}
          filename={filename}
          size={size}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * Resolver de mídia pro `AdfView`: recebe o nó `mediaSingle`/`mediaGroup` (ou o
 * `media` direto) e tenta casar com um anexo de imagem já listado. Mídia
 * externa (`type: 'external'`, com `url`) renderiza direto, sem passar pelo
 * IPC. Sem match → placeholder apontando pra seção de anexos.
 */
// interface congelada: o hook precisa ser exportado deste arquivo, ao lado do
// componente AttachmentsSection — por isso o disable abaixo.
// eslint-disable-next-line react-refresh/only-export-components
export function useMediaResolver(
  issueKey: string
): (node: { attrs?: Record<string, unknown> }) => ReactNode {
  const { data } = useAttachmentsQuery(issueKey)
  const images = (data?.attachments ?? []).filter((a) => a.isImage)

  // não é um componente, é a função resolver retornada pelo hook (só devolve
  // JSX condicionalmente) — por isso o disable abaixo.
  // eslint-disable-next-line react/display-name
  return (node: { attrs?: Record<string, unknown> }): ReactNode => {
    // o contrato do resolver só declara `attrs`; o nó real (vindo do AdfView) tem
    // `type`/`content` também — lidos via cast pra achar o `media` filho.
    const raw = node as unknown as {
      type?: string
      attrs?: Record<string, unknown>
      content?: Array<{ type?: string; attrs?: Record<string, unknown> }>
    }
    const mediaNode =
      raw.type === 'media' ? raw : (raw.content ?? []).find((c) => c.type === 'media')
    const attrs = mediaNode?.attrs ?? {}

    if (attrs.type === 'external' && typeof attrs.url === 'string') {
      return <img src={attrs.url} alt="" className="max-h-40 rounded-md border border-zinc-800" />
    }

    const alt = typeof attrs.alt === 'string' ? attrs.alt : undefined
    const byAlt = alt ? images.find((a) => a.filename === alt) : undefined
    const match = byAlt ?? (images.length === 1 ? images[0] : undefined)

    if (!match) {
      return <p className="text-xs text-zinc-600 italic">[anexo — ver na lista de anexos]</p>
    }

    return (
      <ResolvedMediaImage attachmentId={match.id} filename={match.filename} size={match.size} />
    )
  }
}
