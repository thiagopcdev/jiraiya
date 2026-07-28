import { describe, expect, it } from 'vitest'
import type { AiProviderId } from '@shared/domain'
import { resolveActiveProviderId } from './registry'
import type { AiProviderStatus } from './types'

function statuses(
  over: Partial<Record<AiProviderId, AiProviderStatus>> = {}
): Record<AiProviderId, AiProviderStatus> {
  const off: AiProviderStatus = { available: false, detail: null }
  return {
    claude: off,
    gemini: off,
    codex: off,
    openrouter: off,
    ...over
  }
}

const ON: AiProviderStatus = { available: true, detail: 'ok' }

describe('resolveActiveProviderId', () => {
  it("'auto' com claude disponível → 'claude' mesmo com os outros disponíveis", () => {
    const s = statuses({ claude: ON, gemini: ON, codex: ON, openrouter: ON })
    expect(resolveActiveProviderId('auto', s)).toBe('claude')
  })

  it("'auto' com claude off e gemini on → 'gemini'", () => {
    const s = statuses({ gemini: ON })
    expect(resolveActiveProviderId('auto', s)).toBe('gemini')
  })

  it("'auto' só com codex disponível → 'codex'", () => {
    const s = statuses({ codex: ON })
    expect(resolveActiveProviderId('auto', s)).toBe('codex')
  })

  it("'auto' só com openrouter disponível → 'openrouter'", () => {
    const s = statuses({ openrouter: ON })
    expect(resolveActiveProviderId('auto', s)).toBe('openrouter')
  })

  it("'auto' sem nenhum disponível → null", () => {
    const s = statuses()
    expect(resolveActiveProviderId('auto', s)).toBeNull()
  })

  it("pref explícito 'gemini' disponível → 'gemini'", () => {
    const s = statuses({ claude: ON, gemini: ON })
    expect(resolveActiveProviderId('gemini', s)).toBe('gemini')
  })

  it("pref explícito 'gemini' indisponível → null, NÃO cai para claude mesmo disponível", () => {
    const s = statuses({ claude: ON })
    expect(resolveActiveProviderId('gemini', s)).toBeNull()
  })
})
