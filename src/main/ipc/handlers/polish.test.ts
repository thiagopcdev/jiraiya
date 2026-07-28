import { beforeEach, describe, expect, it, vi } from 'vitest'

const ai = vi.hoisted(() => ({
  provider: null as { id: string; label: string } | null,
  run: null as null | ((feature: string, prompt: string) => Promise<string>)
}))

vi.mock('electron', async () => (await import('../../testing/electronMock')).createElectronMock())
vi.mock('../../ai/service', () => ({
  activeProvider: () => ai.provider,
  runAiPrompt: async (feature: string, prompt: string) => {
    if (!ai.run) throw new Error('runAiPrompt não configurado no teste')
    return ai.run(feature, prompt)
  }
}))

const { invokeHandler } = await import('../../testing/electronMock')
const { AiUnavailableError } = await import('../../ai/types')
const { registerPolishHandlers } = await import('./polish')

beforeEach(() => {
  ai.provider = { id: 'claude', label: 'Claude' }
  ai.run = async () => 'texto melhorado'
  registerPolishHandlers()
})

describe('text:polish', () => {
  it('devolve o texto polido e o provider que respondeu', async () => {
    const res = await invokeHandler('text:polish', { text: 'txt ruim', context: 'comment' })
    expect(res.ok && res.data).toEqual({ text: 'texto melhorado', generatedBy: 'claude' })
  })

  it('remove a cerca de código que o modelo às vezes adiciona', async () => {
    ai.run = async () => '```markdown\n### Contexto\nok\n```'
    const res = await invokeHandler('text:polish', { text: 'txt', context: 'description' })
    expect(res.ok && res.data.text).toBe('### Contexto\nok')
  })

  it('contexto description usa o modelo de draft; comment usa o de comment', async () => {
    const features: string[] = []
    ai.run = async (feature) => {
      features.push(feature)
      return 'ok'
    }
    await invokeHandler('text:polish', { text: 'a', context: 'description' })
    await invokeHandler('text:polish', { text: 'a', context: 'comment' })
    expect(features).toEqual(['draft', 'comment'])
  })

  it('sem provider de IA → AI_UNAVAILABLE', async () => {
    ai.provider = null
    const res = await invokeHandler('text:polish', { text: 'txt', context: 'comment' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
    expect(res.message).toContain('Ajustes')
  })

  it('resposta vazia → AI_UNAVAILABLE citando o provider', async () => {
    ai.run = async () => '   '
    const res = await invokeHandler('text:polish', { text: 'txt', context: 'comment' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
    expect(res.message).toBe('Resposta vazia (Claude)')
  })

  it('falha da IA vira AI_UNAVAILABLE com a mensagem original', async () => {
    ai.run = async () => {
      throw new AiUnavailableError('CLI não autenticado')
    }
    const res = await invokeHandler('text:polish', { text: 'txt', context: 'comment' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('AI_UNAVAILABLE')
    expect(res.message).toBe('CLI não autenticado')
  })

  it('texto vazio → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('text:polish', { text: '   ', context: 'comment' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })

  it('contexto desconhecido → INVALID_PAYLOAD', async () => {
    const res = await invokeHandler('text:polish', {
      text: 'txt',
      context: 'outro'
    } as unknown as { text: string; context: 'comment' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('INVALID_PAYLOAD')
  })
})
