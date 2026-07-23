import { dialog, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { AttachmentCache, clearTempDir, tempDirSize, writeTempFile } from '../../attachments/store'

/** Cache LRU compartilhado entre todas as chamadas (module-level, RAM apenas). */
const cache = new AttachmentCache()

/** Acima disso o `full` não vai inline pro renderer (usar salvar/abrir). */
const INLINE_MAX_BYTES = 8 * 1024 * 1024

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function requireClient(ctx: AppContext): NonNullable<ReturnType<typeof ctx.getClient>> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return client
}

export function registerAttachmentHandlers(ctx: AppContext): void {
  handle('issues:attachments', async ({ key }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const raw = await client.issueAttachments(key.trim().toUpperCase())
    const attachments = raw.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      isImage: a.mimeType?.startsWith('image/') ?? false
    }))
    return { attachments }
  })

  handle('issues:attachmentData', async ({ attachmentId, variant }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)

    const cacheKey = `${variant}:${attachmentId}`
    const hit = cache.get(cacheKey)
    if (hit) {
      return {
        dataUri: toDataUri(hit.data, hit.mimeType),
        mimeType: hit.mimeType,
        tooLarge: false
      }
    }

    const { data, mimeType } =
      variant === 'thumbnail'
        ? await client.attachmentThumbnail(attachmentId)
        : await client.attachmentContent(attachmentId)

    // arquivo cheio grande demais → não cacheia, não inline
    if (variant === 'full' && data.length > INLINE_MAX_BYTES) {
      return { dataUri: null, mimeType, tooLarge: true }
    }

    cache.set(cacheKey, { data, mimeType })
    return { dataUri: toDataUri(data, mimeType), mimeType, tooLarge: false }
  })

  handle('issues:attachmentSave', async ({ attachmentId, filename }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const win = ctx.mainWindow
    if (!win) return { saved: false, path: null }

    const result = await dialog.showSaveDialog(win, { defaultPath: filename })
    if (result.canceled || !result.filePath) return { saved: false, path: null }

    const { data } = await downloadFull(client, attachmentId)
    await writeFile(result.filePath, data)
    return { saved: true, path: result.filePath }
  })

  handle('issues:attachmentOpen', async ({ attachmentId, filename }) => {
    requireWorkspace(ctx)
    const client = requireClient(ctx)
    const { data } = await downloadFull(client, attachmentId)
    const path = await writeTempFile(filename, data)
    await shell.openPath(path)
    return { ok: true as const }
  })

  handle('app:tempFiles', () => ({ bytes: tempDirSize() }))

  handle('app:tempClear', () => ({ ok: true as const, freedBytes: clearTempDir() }))
}

function toDataUri(data: Buffer, mimeType: string | null): string {
  return `data:${mimeType ?? 'application/octet-stream'};base64,${data.toString('base64')}`
}

/** Baixa o conteúdo cheio usando o cache `full:` quando disponível. */
async function downloadFull(
  client: NonNullable<ReturnType<AppContext['getClient']>>,
  attachmentId: string
): Promise<{ data: Buffer; mimeType: string | null }> {
  const cacheKey = `full:${attachmentId}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const result = await client.attachmentContent(attachmentId)
  if (result.data.length <= INLINE_MAX_BYTES) cache.set(cacheKey, result)
  return result
}
