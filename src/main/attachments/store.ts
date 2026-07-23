import { app } from 'electron'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { writeFile, mkdir } from 'fs/promises'
import { basename, join } from 'path'

interface CacheEntry {
  data: Buffer
  mimeType: string | null
}

/**
 * Cache LRU em memória de bytes de anexos (RAM apenas — zero disco).
 * Lógica pura e testável: não importa nada do Electron.
 */
export class AttachmentCache {
  private readonly maxEntries: number
  private readonly maxBytes: number
  // Map preserva ordem de inserção → usado como fila de recência (front = mais antigo)
  private readonly entries = new Map<string, CacheEntry>()
  private bytes = 0

  constructor(opts?: { maxEntries?: number; maxBytes?: number }) {
    this.maxEntries = opts?.maxEntries ?? 30
    this.maxBytes = opts?.maxBytes ?? 50 * 1024 * 1024
  }

  get(key: string): CacheEntry | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    // toca a recência: move para o fim
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, value: CacheEntry): void {
    // item maior que o teto total nunca cacheia
    if (value.data.length > this.maxBytes) return

    const existing = this.entries.get(key)
    if (existing) {
      this.bytes -= existing.data.length
      this.entries.delete(key)
    }
    this.entries.set(key, value)
    this.bytes += value.data.length

    // evicta o mais antigo até caber (entradas e bytes)
    while (
      this.entries.size > this.maxEntries ||
      (this.bytes > this.maxBytes && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      const removed = this.entries.get(oldest)
      this.entries.delete(oldest)
      if (removed) this.bytes -= removed.data.length
    }
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }

  get totalBytes(): number {
    return this.bytes
  }
}

export const TEMP_SUBDIR = 'jiraiya-attachments'

export function tempDirPath(): string {
  return join(app.getPath('temp'), TEMP_SUBDIR)
}

/** Sanitiza o nome: só o basename, sem `..` nem separadores; fallback 'arquivo'. */
function safeFilename(filename: string): string {
  const base = basename(filename).replace(/\.\.+/g, '.').trim()
  return base.length > 0 && base !== '.' ? base : 'arquivo'
}

/** Grava bytes num arquivo temporário (mkdir -p), retorna o path final. */
export async function writeTempFile(filename: string, data: Buffer): Promise<string> {
  const dir = tempDirPath()
  await mkdir(dir, { recursive: true })
  const path = join(dir, safeFilename(filename))
  await writeFile(path, data)
  return path
}

/** Soma dos bytes dos arquivos no temp dir (0 se não existe). */
export function tempDirSize(): number {
  const dir = tempDirPath()
  if (!existsSync(dir)) return 0
  let total = 0
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, name))
      if (st.isFile()) total += st.size
    } catch {
      // arquivo sumiu entre o readdir e o stat — ignora
    }
  }
  return total
}

/** Apaga os arquivos do temp dir; retorna os bytes liberados. */
export function clearTempDir(): number {
  const dir = tempDirPath()
  if (!existsSync(dir)) return 0
  let freed = 0
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (st.isFile()) {
        unlinkSync(path)
        freed += st.size
      }
    } catch {
      // ignora arquivos que não dão para remover
    }
  }
  return freed
}
