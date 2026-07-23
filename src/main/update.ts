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
}

/**
 * Busca a última release do repo no GitHub. Lança Error com mensagem legível em
 * 404/erros — o chamador (checkForUpdate) captura e não propaga.
 */
export async function fetchLatestRelease(
  token: string | null
): Promise<{ version: string; url: string } | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
    headers
  })
  if (res.status === 404) {
    throw new Error('release não encontrada — repo privado exige token')
  }
  if (!res.ok) {
    throw new Error(`GitHub respondeu ${res.status}`)
  }
  const body = (await res.json()) as GithubRelease
  if (!body.tag_name) return null
  return { version: body.tag_name.replace(/^v/i, ''), url: body.html_url ?? '' }
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
