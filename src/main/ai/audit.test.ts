import { describe, expect, it } from 'vitest'
import { describeHttpCall, redactCommandLine } from './audit'

describe('redactCommandLine', () => {
  it('args curtos são preservados', () => {
    expect(redactCommandLine('claude', ['-p', 'oi', '--model', 'sonnet'])).toBe(
      'claude -p oi --model sonnet'
    )
  })

  it('arg maior que maxPromptLen é truncado com sufixo de excedente; flags depois preservadas', () => {
    const prompt = 'x'.repeat(320)
    const out = redactCommandLine('claude', ['-p', prompt, '--model', 'sonnet'], 300)
    expect(out).toContain('x'.repeat(300))
    expect(out).toContain('… (+20 chars)')
    expect(out.endsWith('--model sonnet')).toBe(true)
  })

  it('prompt de 5000 chars com maxPromptLen 300: contém os 300 primeiros e não contém o miolo', () => {
    const inicio = 'a'.repeat(300)
    const miolo = 'b'.repeat(100)
    const prompt = inicio + miolo + 'c'.repeat(4600)
    const out = redactCommandLine('claude', ['-p', prompt], 300)
    expect(out).toContain(inicio)
    expect(out).not.toContain(miolo)
  })
})

describe('describeHttpCall', () => {
  it('descreve chamada HTTP sem headers/key', () => {
    const out = describeHttpCall(
      'POST',
      'https://openrouter.ai/api/v1/chat/completions',
      'openai/gpt-5-mini'
    )
    expect(out).toBe('POST https://openrouter.ai/api/v1/chat/completions model=openai/gpt-5-mini')
  })
})
