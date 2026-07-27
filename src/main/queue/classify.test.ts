import { describe, expect, it } from 'vitest'
import { isRetryableNetworkError } from './classify'
import { JiraAuthError, JiraHttpError } from '../jira/http'

describe('isRetryableNetworkError', () => {
  it('JiraAuthError (subclasse de JiraHttpError) → false mesmo com status 500', () => {
    expect(isRetryableNetworkError(new JiraAuthError(500))).toBe(false)
    expect(isRetryableNetworkError(new JiraAuthError(401, 'unauthorized'))).toBe(false)
  })

  it.each([500, 503, 429])('JiraHttpError com status %d → true', (status) => {
    expect(isRetryableNetworkError(new JiraHttpError(status, 'erro'))).toBe(true)
  })

  it.each([400, 404, 422])('JiraHttpError com status %d → false', (status) => {
    expect(isRetryableNetworkError(new JiraHttpError(status, 'erro'))).toBe(false)
  })

  it.each([
    'ENOTFOUND',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET'
  ])('erro com code %s → true', (code) => {
    expect(isRetryableNetworkError(Object.assign(new Error('x'), { code }))).toBe(true)
  })

  it('code retryable aninhado em cause (até profundidade 3) → true', () => {
    const err = new Error('fetch failed', {
      cause: Object.assign(new Error(), { code: 'ENOTFOUND' })
    })
    expect(isRetryableNetworkError(err)).toBe(true)
  })

  it('TypeError("fetch failed") → true', () => {
    expect(isRetryableNetworkError(new TypeError('fetch failed'))).toBe(true)
  })

  it("erro com name 'AbortError' → true", () => {
    const err = new Error('abortado')
    err.name = 'AbortError'
    expect(isRetryableNetworkError(err)).toBe(true)
  })

  it("erro com name 'TimeoutError' → true", () => {
    const err = new Error('timeout')
    err.name = 'TimeoutError'
    expect(isRetryableNetworkError(err)).toBe(true)
  })

  it('Error genérico, string, null, undefined e objeto vazio → false', () => {
    expect(isRetryableNetworkError(new Error('qualquer'))).toBe(false)
    expect(isRetryableNetworkError('erro qualquer')).toBe(false)
    expect(isRetryableNetworkError(null)).toBe(false)
    expect(isRetryableNetworkError(undefined)).toBe(false)
    expect(isRetryableNetworkError({})).toBe(false)
  })
})
