import { describe, expect, it } from 'vitest'
import {
  buildOpenRouterRequest,
  parseClaudeOutput,
  parseGeminiOutput,
  parseOpenRouterResponse
} from './parsers'
import { AiUnavailableError } from './types'

describe('parseClaudeOutput', () => {
  it('extrai o campo result', () => {
    expect(parseClaudeOutput('{"result":"ok"}')).toBe('ok')
  })

  it('result vazio com is_error false lança AiUnavailableError', () => {
    expect(() => parseClaudeOutput('{"result":"","is_error":false}')).toThrow(AiUnavailableError)
  })

  it('is_error true lança AiUnavailableError', () => {
    expect(() => parseClaudeOutput('{"is_error":true,"result":"x"}')).toThrow(AiUnavailableError)
  })

  it('saída que não é json lança AiUnavailableError', () => {
    expect(() => parseClaudeOutput('não é json')).toThrow(AiUnavailableError)
  })
})

describe('parseGeminiOutput', () => {
  it('extrai o campo response', () => {
    expect(parseGeminiOutput('{"response":"olá"}')).toBe('olá')
  })

  it('error.message vira parte da mensagem lançada', () => {
    expect(() => parseGeminiOutput('{"error":{"message":"quota"}}')).toThrow(/quota/)
  })

  it('texto puro (fallback de CLIs antigos) devolve o próprio texto com trim', () => {
    expect(parseGeminiOutput('texto puro qualquer')).toBe('texto puro qualquer')
  })

  it('string vazia lança AiUnavailableError', () => {
    expect(() => parseGeminiOutput('')).toThrow(AiUnavailableError)
  })

  it('string só de espaços lança AiUnavailableError', () => {
    expect(() => parseGeminiOutput('   ')).toThrow(AiUnavailableError)
  })
})

describe('parseOpenRouterResponse', () => {
  it('extrai choices[0].message.content', () => {
    expect(parseOpenRouterResponse({ choices: [{ message: { content: 'oi' } }] })).toBe('oi')
  })

  it('choices vazio lança AiUnavailableError', () => {
    expect(() => parseOpenRouterResponse({ choices: [] })).toThrow(AiUnavailableError)
  })

  it('content vazio lança AiUnavailableError', () => {
    expect(() => parseOpenRouterResponse({ choices: [{ message: { content: '' } }] })).toThrow(
      AiUnavailableError
    )
  })

  it('error.message lança AiUnavailableError', () => {
    expect(() => parseOpenRouterResponse({ error: { message: 'bad key' } })).toThrow(
      AiUnavailableError
    )
  })

  it('resposta null lança AiUnavailableError', () => {
    expect(() => parseOpenRouterResponse(null)).toThrow(AiUnavailableError)
  })
})

describe('buildOpenRouterRequest', () => {
  it('monta url, method, headers e body corretos', () => {
    const { url, init } = buildOpenRouterRequest({
      apiKey: 'k',
      model: 'm',
      prompt: 'p'
    })

    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer k')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['HTTP-Referer']).toBeTruthy()
    expect(headers['X-Title']).toBeTruthy()

    expect(JSON.parse(init.body as string)).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'p' }]
    })
  })
})
