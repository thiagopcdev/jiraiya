import { AiUnavailableError } from './types'

/**
 * Parse das respostas de cada provider. Isolado dos transportes (exec/fetch)
 * para ser testável sem processo nem rede. Toda falha vira AiUnavailableError —
 * quem chama decide entre fallback determinístico e erro visível.
 */

/** Envelope do `claude -p --output-format json`. */
interface ClaudeEnvelope {
  result?: unknown
  is_error?: boolean
}

export function parseClaudeOutput(stdout: string): string {
  let parsed: ClaudeEnvelope
  try {
    parsed = JSON.parse(stdout) as ClaudeEnvelope
  } catch {
    throw new AiUnavailableError('Resposta do CLI em formato inesperado')
  }
  if (parsed.is_error || typeof parsed.result !== 'string' || parsed.result.trim() === '') {
    throw new AiUnavailableError('Claude retornou erro ou resposta vazia')
  }
  return parsed.result.trim()
}

/** Envelope do `gemini -o json`; versões antigas do CLI cospem texto puro. */
interface GeminiEnvelope {
  response?: unknown
  error?: { message?: unknown }
}

export function parseGeminiOutput(stdout: string): string {
  let parsed: GeminiEnvelope | null = null
  try {
    const candidate = JSON.parse(stdout) as unknown
    if (typeof candidate === 'object' && candidate !== null) parsed = candidate as GeminiEnvelope
  } catch {
    // não é JSON: CLI antigo sem --output-format json → o stdout já é a resposta
  }

  if (parsed) {
    const errorMessage = parsed.error?.message
    if (typeof errorMessage === 'string' && errorMessage.trim() !== '') {
      throw new AiUnavailableError(errorMessage.trim())
    }
    if (typeof parsed.response === 'string' && parsed.response.trim() !== '') {
      return parsed.response.trim()
    }
    throw new AiUnavailableError('Gemini retornou erro ou resposta vazia')
  }

  const text = stdout.trim()
  if (text === '') throw new AiUnavailableError('Gemini retornou erro ou resposta vazia')
  return text
}

/** Resposta do endpoint /chat/completions do OpenRouter (formato OpenAI). */
interface OpenRouterEnvelope {
  error?: { message?: unknown }
  choices?: Array<{ message?: { content?: unknown } }>
}

export function parseOpenRouterResponse(json: unknown): string {
  const envelope = (typeof json === 'object' && json !== null ? json : {}) as OpenRouterEnvelope

  const errorMessage = envelope.error?.message
  if (typeof errorMessage === 'string' && errorMessage.trim() !== '') {
    throw new AiUnavailableError(errorMessage.trim())
  }

  const content = envelope.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiUnavailableError('IA retornou erro ou resposta vazia')
  }
  return content.trim()
}

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Monta a chamada REST do OpenRouter. Os headers HTTP-Referer/X-Title são o que
 * identifica o app no ranking deles — não são obrigatórios, mas são a boa prática.
 */
export function buildOpenRouterRequest(input: { apiKey: string; model: string; prompt: string }): {
  url: string
  init: RequestInit
} {
  return {
    url: OPENROUTER_CHAT_URL,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/thiagopcdev/jiraiya',
        'X-Title': 'Jiraiya'
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: input.prompt }]
      })
    }
  }
}
