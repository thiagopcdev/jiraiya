import { createWriteStream, mkdirSync } from 'node:fs'
import { once } from 'node:events'
import { basename, join } from 'node:path'
import { app, Notification, shell } from 'electron'
import type Database from 'better-sqlite3'
import { getWorkspaceRow } from './db/repos/workspace'
import { getCredential } from './security/credentials'

export const RELEASES_REPO = 'thiagopcdev/jiraiya'

/**
 * Compara duas versões semver simples (x.y.z), ignorando prefixo 'v'. Partes
 * ausentes valem 0. a>b → 1, igual → 0, a<b → -1.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

interface GithubRelease {
  tag_name?: string
  html_url?: string
  assets?: Array<{ id?: number; name?: string }>
}

/** Headers da API do GitHub; Authorization só quando há token configurado. */
function githubHeaders(token: string | null, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * GET /releases/latest cru. Lança Error com mensagem legível em 404/erros — os
 * chamadores (checkForUpdate / downloadUpdate) decidem se propagam.
 */
async function fetchLatestReleaseRaw(token: string | null): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers: githubHeaders(token, 'application/vnd.github+json')
  })
  if (res.status === 404) {
    throw new Error('release não encontrada — repo privado exige token')
  }
  if (!res.ok) {
    throw new Error(`GitHub respondeu ${res.status}`)
  }
  return (await res.json()) as GithubRelease
}

/**
 * Busca a última release do repo no GitHub. Lança Error com mensagem legível em
 * 404/erros — o chamador (checkForUpdate) captura e não propaga.
 */
export async function fetchLatestRelease(
  token: string | null
): Promise<{ version: string; url: string } | null> {
  const body = await fetchLatestReleaseRaw(token)
  if (!body.tag_name) return null
  return { version: body.tag_name.replace(/^v/i, ''), url: body.html_url ?? '' }
}

/**
 * Escolhe o asset do instalador para a plataforma: darwin → primeiro nome
 * terminando em `.dmg`; win32 → primeiro terminando em `-setup.exe` (fallback:
 * qualquer `.exe`); outras plataformas → null. Função pura.
 */
export function pickUpdateAsset(
  assets: Array<{ name: string; apiUrl: string }>,
  platform: NodeJS.Platform
): { name: string; apiUrl: string } | null {
  const endsWith = (suffix: string): { name: string; apiUrl: string } | null =>
    assets.find((a) => a.name.toLowerCase().endsWith(suffix)) ?? null

  if (platform === 'darwin') return endsWith('.dmg')
  if (platform === 'win32') return endsWith('-setup.exe') ?? endsWith('.exe')
  return null
}

export interface UpdateStatus {
  current: string
  latest: string | null
  url: string | null
  available: boolean
  tokenConfigured: boolean
  error: string | null
}

function getPref(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value_json FROM user_pref WHERE key = ?`).get(key) as
    { value_json: string } | undefined
  return row?.value_json ?? null
}

function setPref(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_pref (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(key, value)
}

/**
 * Consulta a última release e monta o status. Erros de rede/404 NÃO lançam:
 * retornam { available: false, latest: null, error }. Quando há update e
 * `notify`, emite uma notificação uma única vez por versão. Sempre faz push
 * quando há update disponível.
 */
export async function checkForUpdate(
  db: Database.Database,
  opts: { notify: boolean; push: (v: { version: string; url: string }) => void }
): Promise<UpdateStatus> {
  const current = app.getVersion()
  const workspace = getWorkspaceRow(db)
  const token = workspace ? getCredential(db, workspace.id, 'github_token') : null
  const tokenConfigured = token !== null

  let latest: { version: string; url: string } | null
  try {
    latest = await fetchLatestRelease(token)
  } catch (err) {
    return {
      current,
      latest: null,
      url: null,
      available: false,
      tokenConfigured,
      error: err instanceof Error ? err.message : 'Falha ao verificar atualização'
    }
  }

  if (!latest) {
    return { current, latest: null, url: null, available: false, tokenConfigured, error: null }
  }

  const available = compareVersions(latest.version, current) > 0
  if (available) {
    opts.push({ version: latest.version, url: latest.url })
    if (opts.notify && Notification.isSupported()) {
      const already = getPref(db, 'lastNotifiedUpdate')
      if (already !== latest.version) {
        const n = new Notification({
          title: 'Atualização disponível',
          body: `Jiraiya v${latest.version}`
        })
        n.on('click', () => void shell.openExternal(latest.url))
        n.show()
        setPref(db, 'lastNotifiedUpdate', latest.version)
      }
    }
  }

  return {
    current,
    latest: latest.version,
    url: latest.url,
    available,
    tokenConfigured,
    error: null
  }
}

/**
 * Baixa o instalador da release mais nova para a pasta temp e devolve o path.
 * Streaming com contagem de bytes: `onProgress` é chamado a cada ~1% quando a
 * resposta traz `content-length`; sem content-length chama `onProgress(-1)` uma
 * vez (indeterminado) e segue sem progresso. Lança Error legível quando não há
 * versão mais nova, quando a release não tem instalador para a plataforma ou
 * quando o download falha.
 */
export async function downloadUpdate(
  db: Database.Database,
  onProgress: (percent: number) => void
): Promise<string> {
  const current = app.getVersion()
  const workspace = getWorkspaceRow(db)
  const token = workspace ? getCredential(db, workspace.id, 'github_token') : null

  const release = await fetchLatestReleaseRaw(token)
  const version = release.tag_name?.replace(/^v/i, '') ?? null
  if (!version) throw new Error('release sem versão (tag) — nada para baixar')
  if (compareVersions(version, current) <= 0) {
    throw new Error(`você já está na versão mais recente (v${current})`)
  }

  const assets = (release.assets ?? [])
    .filter((a): a is { id: number; name: string } => Boolean(a.name) && typeof a.id === 'number')
    .map((a) => ({
      name: a.name,
      apiUrl: `https://api.github.com/repos/${RELEASES_REPO}/releases/assets/${a.id}`
    }))

  const asset = pickUpdateAsset(assets, process.platform)
  if (!asset) throw new Error('instalador para esta plataforma não encontrado na release')

  const res = await fetch(asset.apiUrl, {
    headers: githubHeaders(token, 'application/octet-stream'),
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`falha ao baixar o instalador (HTTP ${res.status})`)
  if (!res.body) throw new Error('resposta do download sem corpo')

  const dir = join(app.getPath('temp'), 'jiraiya-update')
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, basename(asset.name))

  const totalRaw = Number.parseInt(res.headers.get('content-length') ?? '', 10)
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0
  if (total === 0) onProgress(-1)

  const file = createWriteStream(dest)
  let lastPercent = -1
  try {
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!file.write(value)) await once(file, 'drain')
      if (total > 0) {
        const percent = Math.min(100, Math.floor((received / total) * 100))
        if (percent > lastPercent) {
          lastPercent = percent
          onProgress(percent)
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.on('error', reject)
      file.end(() => resolve())
    })
  } catch (err) {
    file.destroy()
    throw err instanceof Error ? err : new Error('falha ao gravar o instalador')
  }

  // garante o 100% final mesmo se content-length subestimar o corpo
  if (total > 0 && lastPercent < 100) onProgress(100)
  return dest
}
