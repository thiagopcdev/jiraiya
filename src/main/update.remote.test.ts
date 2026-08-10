import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrations'
import { storeCredential } from './security/credentials'
import { shownNotifications, resetElectronMock } from './testing/electronMock'

/** Versão instalada e pasta temp controladas pelo teste. */
const appState = vi.hoisted(() => ({ version: '1.0.0', temp: '' }))

vi.mock('electron', async () => {
  const base = (await import('./testing/electronMock')).createElectronMock()
  return {
    ...base,
    app: {
      ...(base.app as object),
      getVersion: () => appState.version,
      getPath: (name: string) => (name === 'temp' ? appState.temp : tmpdir())
    }
  }
})

appState.temp = mkdtempSync(join(tmpdir(), 'jiraiya-update-'))

const { checkForUpdate, downloadUpdate, fetchLatestRelease, RELEASES_REPO } =
  await import('./update')

const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`

interface FakeResponse {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
  headers?: { get: (k: string) => string | null }
  body?: ReadableStream<Uint8Array> | null
}

function releaseResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[i++])
    }
  })
}

function assetResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): FakeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: streamOf(chunks)
  }
}

function chunk(size: number, fill = 65): Uint8Array {
  return new Uint8Array(size).fill(fill)
}

/** Programa o fetch por URL: /releases/latest e o asset do instalador. */
function stubFetch(
  handler: (url: string, init?: RequestInit) => FakeResponse
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', mock)
  return mock as unknown as ReturnType<typeof vi.fn>
}

let db: Database.Database

function insertWorkspace(): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (1, 'https://x.atlassian.net', 'e@x.com', 'acc-1', 'now')`
  ).run()
}

beforeEach(() => {
  resetElectronMock()
  appState.version = '1.0.0'
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  rmSync(appState.temp, { recursive: true, force: true })
})

describe('fetchLatestRelease', () => {
  it('devolve versão sem o prefixo v e a URL da release', async () => {
    stubFetch(() => releaseResponse({ tag_name: 'v1.2.0', html_url: 'https://x/rel' }))

    await expect(fetchLatestRelease(null)).resolves.toEqual({
      version: '1.2.0',
      url: 'https://x/rel'
    })
  })

  it('release sem html_url devolve url vazia', async () => {
    stubFetch(() => releaseResponse({ tag_name: '1.2.0' }))

    await expect(fetchLatestRelease(null)).resolves.toEqual({ version: '1.2.0', url: '' })
  })

  it('release sem tag devolve null', async () => {
    stubFetch(() => releaseResponse({}))

    await expect(fetchLatestRelease(null)).resolves.toBeNull()
  })

  it('404 explica que repo privado exige token', async () => {
    stubFetch(() => releaseResponse({}, 404))

    await expect(fetchLatestRelease(null)).rejects.toThrow(
      'release não encontrada — repo privado exige token'
    )
  })

  it('outros erros HTTP citam o status', async () => {
    stubFetch(() => releaseResponse({}, 503))

    await expect(fetchLatestRelease(null)).rejects.toThrow('GitHub respondeu 503')
  })

  it('sem token não manda Authorization; com token manda Bearer', async () => {
    const semToken = stubFetch(() => releaseResponse({ tag_name: '1.0.0' }))
    await fetchLatestRelease(null)
    const headersSemToken = (semToken.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(headersSemToken.Accept).toBe('application/vnd.github+json')
    expect(headersSemToken.Authorization).toBeUndefined()

    const comToken = stubFetch(() => releaseResponse({ tag_name: '1.0.0' }))
    await fetchLatestRelease('ghp_x')
    const headers = (comToken.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghp_x')
  })
})

describe('checkForUpdate', () => {
  it('versão nova: available, push e notificação uma única vez por versão', async () => {
    stubFetch(() => releaseResponse({ tag_name: 'v1.2.0', html_url: 'https://x/rel' }))
    const push = vi.fn()

    const status = await checkForUpdate(db, { notify: true, push })

    expect(status).toEqual({
      current: '1.0.0',
      latest: '1.2.0',
      url: 'https://x/rel',
      available: true,
      tokenConfigured: false,
      error: null
    })
    expect(push).toHaveBeenCalledWith({ version: '1.2.0', url: 'https://x/rel' })
    expect(shownNotifications).toEqual([
      { title: 'Atualização disponível', body: 'Jiraiya v1.2.0' }
    ])

    // segunda checagem da MESMA versão: push de novo, notificação não
    await checkForUpdate(db, { notify: true, push })
    expect(push).toHaveBeenCalledTimes(2)
    expect(shownNotifications).toHaveLength(1)
  })

  it('versão ainda mais nova volta a notificar', async () => {
    stubFetch(() => releaseResponse({ tag_name: '1.2.0', html_url: 'u' }))
    await checkForUpdate(db, { notify: true, push: vi.fn() })

    stubFetch(() => releaseResponse({ tag_name: '1.3.0', html_url: 'u' }))
    await checkForUpdate(db, { notify: true, push: vi.fn() })

    expect(shownNotifications.map((n) => n.body)).toEqual(['Jiraiya v1.2.0', 'Jiraiya v1.3.0'])
  })

  it('notify false faz push mas não notifica', async () => {
    stubFetch(() => releaseResponse({ tag_name: '1.2.0', html_url: 'u' }))
    const push = vi.fn()

    await checkForUpdate(db, { notify: false, push })

    expect(push).toHaveBeenCalledTimes(1)
    expect(shownNotifications).toEqual([])
  })

  it('mesma versão instalada: nada disponível, sem push', async () => {
    stubFetch(() => releaseResponse({ tag_name: 'v1.0.0', html_url: 'u' }))
    const push = vi.fn()

    const status = await checkForUpdate(db, { notify: true, push })

    expect(status.available).toBe(false)
    expect(status.latest).toBe('1.0.0')
    expect(push).not.toHaveBeenCalled()
    expect(shownNotifications).toEqual([])
  })

  it('release sem tag: latest null sem erro', async () => {
    stubFetch(() => releaseResponse({}))

    await expect(checkForUpdate(db, { notify: true, push: vi.fn() })).resolves.toEqual({
      current: '1.0.0',
      latest: null,
      url: null,
      available: false,
      tokenConfigured: false,
      error: null
    })
  })

  it('404 não lança: devolve o erro no status', async () => {
    stubFetch(() => releaseResponse({}, 404))

    const status = await checkForUpdate(db, { notify: true, push: vi.fn() })

    expect(status.available).toBe(false)
    expect(status.error).toBe('release não encontrada — repo privado exige token')
  })

  it('falha de rede vira erro no status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )

    const status = await checkForUpdate(db, { notify: true, push: vi.fn() })
    expect(status.error).toBe('fetch failed')
  })

  it('rejeição não-Error tem mensagem genérica', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'pane'
      })
    )

    const status = await checkForUpdate(db, { notify: true, push: vi.fn() })
    expect(status.error).toBe('Falha ao verificar atualização')
  })

  it('token do workspace é usado e reportado em tokenConfigured', async () => {
    insertWorkspace()
    storeCredential(db, 1, 'github_token', 'ghp_secreto')
    const fetchMock = stubFetch(() => releaseResponse({ tag_name: '1.0.0', html_url: 'u' }))

    const status = await checkForUpdate(db, { notify: true, push: vi.fn() })

    expect(status.tokenConfigured).toBe(true)
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghp_secreto')
    expect(fetchMock.mock.calls[0][0]).toBe(LATEST_URL)
  })

  it('workspace sem token do GitHub reporta tokenConfigured false', async () => {
    insertWorkspace()
    stubFetch(() => releaseResponse({ tag_name: '1.0.0', html_url: 'u' }))

    const status = await checkForUpdate(db, { notify: true, push: vi.fn() })
    expect(status.tokenConfigured).toBe(false)
  })
})

describe('downloadUpdate', () => {
  const dmgRelease = {
    tag_name: 'v1.2.0',
    html_url: 'u',
    assets: [
      { id: 1, name: 'jiraiya-1.2.0.dmg.blockmap' },
      { id: 2, name: 'jiraiya-1.2.0.dmg' },
      { name: 'sem-id.dmg' }
    ]
  }

  // o download lê process.platform direto, e o app só publica instalador de
  // macOS e Windows. Sem fixar a plataforma, a suíte inteira passa no mac do
  // dev e quebra no CI (ubuntu), onde pickUpdateAsset devolve null e todo
  // caso falha por "instalador não encontrado" em vez do que ele testa.
  // A escolha por plataforma tem cobertura própria em update.pick.test.ts.
  const realPlatform = process.platform
  const setPlatform = (value: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }
  beforeEach(() => setPlatform('darwin'))
  afterEach(() => setPlatform(realPlatform))

  it('baixa o .dmg para a pasta temp e reporta progresso por percentual', async () => {
    const fetchMock = stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : assetResponse([chunk(25), chunk(25), chunk(25), chunk(25)], {
            'content-length': '100'
          })
    )
    const progress: number[] = []

    const dest = await downloadUpdate(db, (p) => progress.push(p))

    expect(dest).toBe(join(appState.temp, 'jiraiya-update', 'jiraiya-1.2.0.dmg'))
    expect(readFileSync(dest).byteLength).toBe(100)
    expect(progress).toEqual([25, 50, 75, 100])
    // o asset escolhido é o .dmg com id (não o blockmap, não o sem id)
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://api.github.com/repos/${RELEASES_REPO}/releases/assets/2`
    )
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(headers.Accept).toBe('application/octet-stream')
  })

  it('sem content-length reporta -1 uma vez e não emite percentuais', async () => {
    stubFetch((url) =>
      url === LATEST_URL ? releaseResponse(dmgRelease) : assetResponse([chunk(10), chunk(10)])
    )
    const progress: number[] = []

    await downloadUpdate(db, (p) => progress.push(p))

    expect(progress).toEqual([-1])
  })

  it('content-length subestimado ainda fecha em 100%', async () => {
    stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : assetResponse([chunk(100)], { 'content-length': '200' })
    )
    const progress: number[] = []

    await downloadUpdate(db, (p) => progress.push(p))

    expect(progress).toEqual([50, 100])
  })

  it('content-length inválido é tratado como ausente', async () => {
    stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : assetResponse([chunk(10)], { 'content-length': 'sei-lá' })
    )
    const progress: number[] = []

    await downloadUpdate(db, (p) => progress.push(p))

    expect(progress).toEqual([-1])
  })

  it('release sem tag não tem o que baixar', async () => {
    stubFetch(() => releaseResponse({ assets: [] }))

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow(
      'release sem versão (tag) — nada para baixar'
    )
  })

  it('versão igual ou anterior à instalada recusa o download', async () => {
    appState.version = '1.2.0'
    stubFetch(() => releaseResponse(dmgRelease))

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow(
      'você já está na versão mais recente (v1.2.0)'
    )
  })

  it('release sem instalador para a plataforma é recusada', async () => {
    stubFetch(() =>
      releaseResponse({ tag_name: '1.2.0', assets: [{ id: 3, name: 'jiraiya-1.2.0.zip' }] })
    )

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow(
      'instalador para esta plataforma não encontrado na release'
    )
  })

  it('HTTP de erro no asset cita o status', async () => {
    stubFetch((url) =>
      url === LATEST_URL ? releaseResponse(dmgRelease) : { ok: false, status: 403 }
    )

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow(
      'falha ao baixar o instalador (HTTP 403)'
    )
  })

  it('resposta sem corpo é recusada', async () => {
    stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : { ok: true, status: 200, headers: { get: () => null }, body: null }
    )

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow('resposta do download sem corpo')
  })

  it('erro no meio do stream propaga e não deixa arquivo pela metade em uso', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk(10))
      },
      pull() {
        throw new Error('conexão caiu no meio')
      }
    })
    stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : {
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k === 'content-length' ? '100' : null) },
            body: failing
          }
    )

    await expect(downloadUpdate(db, vi.fn())).rejects.toThrow('conexão caiu no meio')
    // o diretório de destino existe, mas o download não é dado como concluído
    expect(existsSync(join(appState.temp, 'jiraiya-update'))).toBe(true)
  })

  it('usa o token do workspace no download do asset', async () => {
    insertWorkspace()
    storeCredential(db, 1, 'github_token', 'ghp_dl')
    const fetchMock = stubFetch((url) =>
      url === LATEST_URL
        ? releaseResponse(dmgRelease)
        : assetResponse([chunk(4)], { 'content-length': '4' })
    )

    await downloadUpdate(db, vi.fn())

    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghp_dl')
  })
})
