import { describe, expect, it } from 'vitest'
import { buildAskPrompt } from './ask'

describe('buildAskPrompt', () => {
  const question = 'Quais cards estão em risco esta semana?'
  const snapshotJson = '{"issues":[{"key":"BT-42"}]}'
  const todayIso = '2026-07-23'

  it('contém a question, o snapshotJson e o todayIso', () => {
    const prompt = buildAskPrompt({ question, snapshotJson, todayIso })
    expect(prompt).toContain(question)
    expect(prompt).toContain(snapshotJson)
    expect(prompt).toContain(todayIso)
  })

  it('sem history → não contém a seção de conversa anterior', () => {
    const prompt = buildAskPrompt({ question, snapshotJson, todayIso })
    expect(prompt).not.toContain('=== CONVERSA ANTERIOR ===')
  })

  it('com history → contém a seção e os conteúdos das mensagens com papéis traduzidos', () => {
    const prompt = buildAskPrompt({
      question,
      snapshotJson,
      todayIso,
      history: [
        { role: 'user', content: 'Qual o status do BT-10?' },
        { role: 'assistant', content: 'O BT-10 está em andamento.' }
      ]
    })
    expect(prompt).toContain('=== CONVERSA ANTERIOR ===')
    expect(prompt).toContain('Qual o status do BT-10?')
    expect(prompt).toContain('O BT-10 está em andamento.')
    expect(prompt).toContain('Usuário')
    expect(prompt).toContain('Jiraiya')
  })

  it('contém instrução de responder em português e de citar keys', () => {
    const prompt = buildAskPrompt({ question, snapshotJson, todayIso })
    expect(prompt.toLowerCase()).toContain('português')
    expect(prompt.toLowerCase()).toMatch(/key/)
  })
})
