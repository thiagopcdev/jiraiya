/**
 * Camada HTTP do Jira: Basic auth, fila com concorrência limitada,
 * retry com backoff (respeitando Retry-After em 429) e erros tipados.
 */

export class JiraHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string
  ) {
    super(message)
    this.name = 'JiraHttpError'
  }
}

export class JiraAuthError extends JiraHttpError {
  constructor(status: number, body?: string) {
    super(status, 'Credenciais do Jira inválidas ou expiradas', body)
    this.name = 'JiraAuthError'
  }
}

interface QueueTask {
  run: () => Promise<void>
}

/** Fila simples de concorrência limitada (sem dependência externa). */
class TaskQueue {
  private active = 0
  private queue: QueueTask[] = []

  constructor(private readonly concurrency: number) {}

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            resolve(await fn())
          } catch (err) {
            reject(err)
          }
        }
      })
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!
      this.active++
      void task.run().finally(() => {
        this.active--
        this.pump()
      })
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface JiraHttpOptions {
  siteUrl: string
  email: string
  apiToken: string
  concurrency?: number
  maxRetries?: number
  onAuthError?: () => void
  logger?: (line: string) => void
}

export class JiraHttp {
  private readonly baseUrl: string
  private readonly authHeader: string
  private readonly queue: TaskQueue
  private readonly maxRetries: number
  private readonly onAuthError?: () => void
  private readonly logger?: (line: string) => void

  constructor(opts: JiraHttpOptions) {
    this.baseUrl = opts.siteUrl.replace(/\/$/, '')
    this.authHeader = 'Basic ' + Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64')
    this.queue = new TaskQueue(opts.concurrency ?? 4)
    this.maxRetries = opts.maxRetries ?? 5
    this.onAuthError = opts.onAuthError
    this.logger = opts.logger
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.queue.add(async () => {
      let attempt = 0
      for (;;) {
        const startedAt = Date.now()
        let res: Response
        try {
          res = await fetch(this.baseUrl + path, {
            method,
            headers: {
              Authorization: this.authHeader,
              Accept: 'application/json',
              ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
          })
        } catch (err) {
          // erro de rede: retry com backoff
          if (attempt >= this.maxRetries) throw err
          await sleep(backoffMs(attempt++))
          continue
        }

        this.logger?.(`${method} ${path} ${res.status} ${Date.now() - startedAt}ms`)

        if (res.status === 401 || res.status === 403) {
          this.onAuthError?.()
          throw new JiraAuthError(res.status, await safeText(res))
        }

        if (res.status === 429 || res.status >= 500) {
          if (attempt >= this.maxRetries) {
            throw new JiraHttpError(res.status, `Jira respondeu ${res.status}`, await safeText(res))
          }
          const retryAfter = Number(res.headers.get('retry-after'))
          const waitMs =
            res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : backoffMs(attempt)
          attempt++
          await sleep(waitMs)
          continue
        }

        if (!res.ok) {
          throw new JiraHttpError(res.status, `Jira respondeu ${res.status}`, await safeText(res))
        }

        if (res.status === 204) return undefined as T
        return (await res.json()) as T
      }
    })
  }
}

function backoffMs(attempt: number): number {
  const base = 1000 * Math.pow(2, attempt)
  return Math.min(base, 16000) + Math.random() * 500
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, 2000)
  } catch {
    return undefined
  }
}
