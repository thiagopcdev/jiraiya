import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../db/migrations'
import { listCommandLog } from '../../db/repos/commandLog'
import { AiUnavailableError } from '../types'

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())

const { createOpenRouterProvider } = await import('./openrouter')
const { initAiRegistry } = await import('../registry')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status })
}

const CHAT_OK = { choices: [{ message: { content: 'resposta da IA' } }] }

/**
 * Módulo recarregado: o cache de modelos vive no escopo do módulo, então cada
 * teste de catálogo precisa de uma instância limpa.
 */
async function freshModule(): Promise<typeof import('./openrouter')> {
  vi.resetModules()
  return import('./openrouter')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOpenRouterProvider — metadados e status', () => {
  it('id/label/kind: label é "IA" porque o usuário escolhe o modelo real', () => {
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x' })
    expect(provider.id).toBe('openrouter')
    expect(provider.label).toBe('IA')
    expect(provider.kind).toBe('api')
  })

  it('status disponível com chave', () => {
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x' })
    expect(provider.status()).toEqual({ available: true, detail: 'chave configurada' })
  })

  it('status indisponível sem chave', () => {
    const provider = createOpenRouterProvider({ getApiKey: () => null })
    expect(provider.status()).toEqual({ available: false, detail: 'sem chave de API' })
  })

  it('models() traz só o default mínimo e defaultModel cai no default', () => {
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x' })
    expect(provider.models()).toEqual([{ id: 'openai/gpt-5-mini', label: 'openai/gpt-5-mini' }])
    expect(provider.defaultModel('split')).toBe('openai/gpt-5-mini')
  })
})

describe('createOpenRouterProvider — run', () => {
  it('sucesso: POST com Bearer, body com o prompt e conteúdo parseado', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(CHAT_OK))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-abc', fetchFn })

    await expect(provider.run('meu prompt', 'openai/gpt-5')).resolves.toBe('resposta da IA')

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'openai/gpt-5',
      messages: [{ role: 'user', content: 'meu prompt' }]
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sem chave falha antes de qualquer fetch', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(CHAT_OK))
    const provider = createOpenRouterProvider({ getApiKey: () => null, fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow(/Sem chave de API do OpenRouter/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('HTTP não-2xx com error.message no corpo usa a mensagem do provedor', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { message: 'Insufficient credits' } }, 402)
    )
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow(
      'IA falhou (HTTP 402): Insufficient credits'
    )
  })

  it('HTTP não-2xx com corpo não-JSON usa o corpo cru truncado', async () => {
    const fetchFn = vi.fn(async () => textResponse('<html>502 bad gateway</html>', 502))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow(
      'IA falhou (HTTP 502): <html>502 bad gateway</html>'
    )
  })

  it('HTTP não-2xx com corpo vazio cai no "HTTP <status>"', async () => {
    const fetchFn = vi.fn(async () => textResponse('', 500))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow('IA falhou (HTTP 500): HTTP 500')
  })

  it('200 com corpo inválido → formato inesperado', async () => {
    const fetchFn = vi.fn(async () => textResponse('não é json', 200))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow('Resposta da IA em formato inesperado')
  })

  it('200 com choices vazio → resposta vazia', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ choices: [] }))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow('IA retornou erro ou resposta vazia')
  })

  it('TimeoutError vira mensagem de tempo limite com os segundos', async () => {
    const fetchFn = vi.fn(async () => {
      throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
    })
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    const promise = provider.run('oi', 'm')
    await expect(promise).rejects.toBeInstanceOf(AiUnavailableError)
    await expect(promise).rejects.toThrow('IA excedeu o tempo limite (240s)')
  })

  it('erro de rede comum preserva a mensagem original', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow('fetch failed')
  })

  it('rejeição não-Error é convertida em string', async () => {
    const fetchFn = vi.fn(async () => {
      throw 'boom'
    })
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow('boom')
  })
})

describe('createOpenRouterProvider — auditoria', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    initAiRegistry({ db, getOpenRouterKey: () => 'sk-x' })
  })

  it('sucesso grava linha http sem a chave, com método/URL/modelo', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(CHAT_OK))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-secreta', fetchFn })

    await provider.run('oi', 'openai/gpt-5')

    const [entry] = listCommandLog(db)
    expect(entry.kind).toBe('http')
    expect(entry.provider).toBe('openrouter')
    expect(entry.ok).toBe(true)
    expect(entry.command).toBe(
      'POST https://openrouter.ai/api/v1/chat/completions model=openai/gpt-5'
    )
    expect(entry.command).not.toContain('sk-secreta')
  })

  it('falha grava linha com ok=false e a mensagem', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: { message: 'nope' } }, 401))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).rejects.toThrow()

    const [entry] = listCommandLog(db)
    expect(entry.ok).toBe(false)
    expect(entry.error).toBe('IA falhou (HTTP 401): nope')
  })

  it('erro ao gravar auditoria não derruba a chamada', async () => {
    db.prepare('DROP TABLE command_log').run()
    const fetchFn = vi.fn(async () => jsonResponse(CHAT_OK))
    const provider = createOpenRouterProvider({ getApiKey: () => 'sk-x', fetchFn })

    await expect(provider.run('oi', 'm')).resolves.toBe('resposta da IA')
  })
})

describe('listOpenRouterModels', () => {
  it('ordena por id, usa o id como nome quando falta name e ignora itens sem id', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'z/model', name: 'Zeta' },
          { id: 'a/model' },
          { name: 'sem id' },
          { id: 'm/model', name: 'Meio' }
        ]
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { listOpenRouterModels } = await freshModule()

    await expect(listOpenRouterModels('sk-x')).resolves.toEqual([
      { id: 'a/model', name: 'a/model' },
      { id: 'm/model', name: 'Meio' },
      { id: 'z/model', name: 'Zeta' }
    ])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
  })

  it('corpo sem data devolve lista vazia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}))
    )
    const { listOpenRouterModels } = await freshModule()

    await expect(listOpenRouterModels('sk-x')).resolves.toEqual([])
  })

  it('duas chamadas seguidas fazem um único fetch (cache de 1h)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'a/b', name: 'A' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { listOpenRouterModels } = await freshModule()

    const first = await listOpenRouterModels('sk-x')
    const second = await listOpenRouterModels('sk-x')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('refresh=true ignora o cache e busca de novo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'a/b', name: 'A' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'c/d', name: 'C' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { listOpenRouterModels } = await freshModule()

    await listOpenRouterModels('sk-x')
    const refreshed = await listOpenRouterModels('sk-x', true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refreshed).toEqual([{ id: 'c/d', name: 'C' }])
  })

  it('cache expirado depois de 1h volta a buscar', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'a/b', name: 'A' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { listOpenRouterModels } = await freshModule()

    vi.useFakeTimers()
    try {
      await listOpenRouterModels('sk-x')
      vi.advanceTimersByTime(61 * 60 * 1000)
      await listOpenRouterModels('sk-x')
    } finally {
      vi.useRealTimers()
    }

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('HTTP não-2xx vira AiUnavailableError com a mensagem do corpo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'chave inválida' } }, 401))
    )
    const { listOpenRouterModels } = await freshModule()

    const promise = listOpenRouterModels('sk-ruim')
    // instância vem do módulo recarregado, então compara pelo name
    await expect(promise).rejects.toMatchObject({ name: 'AiUnavailableError' })
    await expect(promise).rejects.toThrow(
      'Não foi possível listar os modelos (HTTP 401): chave inválida'
    )
  })

  it('erro de rede é embalado em AiUnavailableError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const { listOpenRouterModels } = await freshModule()

    const promise = listOpenRouterModels('sk-x')
    await expect(promise).rejects.toMatchObject({ name: 'AiUnavailableError' })
    await expect(promise).rejects.toThrow('fetch failed')
  })

  it('timeout tem mensagem própria', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('timed out'), { name: 'AbortError' })
      })
    )
    const { listOpenRouterModels } = await freshModule()

    await expect(listOpenRouterModels('sk-x')).rejects.toThrow(/excedeu o tempo limite \(240s\)/)
  })
})

describe('validateOpenRouterKey', () => {
  it('devolve true quando a API responde 2xx', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { validateOpenRouterKey } = await freshModule()

    await expect(validateOpenRouterKey('sk-boa')).resolves.toBe(true)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-boa')
  })

  it('devolve false em 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 401))
    )
    const { validateOpenRouterKey } = await freshModule()

    await expect(validateOpenRouterKey('sk-ruim')).resolves.toBe(false)
  })

  it('devolve false quando o fetch explode (offline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const { validateOpenRouterKey } = await freshModule()

    await expect(validateOpenRouterKey('sk-x')).resolves.toBe(false)
  })

  it('não grava nada na auditoria (é verificação, não execução)', async () => {
    const db = new Database(':memory:')
    runMigrations(db)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [] }))
    )
    vi.resetModules()
    const { validateOpenRouterKey } = await import('./openrouter')
    const registry = await import('../registry')
    registry.initAiRegistry({ db, getOpenRouterKey: () => 'sk-x' })

    await validateOpenRouterKey('sk-x')
    expect(listCommandLog(db)).toEqual([])
  })
})
