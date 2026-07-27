import { describe, expect, it } from 'vitest'
import { buildPolishPrompt, cleanPolishedText } from './polish'

describe('cleanPolishedText', () => {
  it('remove espaços nas pontas (trim básico)', () => {
    expect(cleanPolishedText('  texto  ')).toBe('texto')
  })

  it('remove cerca de código envolvente sem linguagem', () => {
    const raw = '```\n## Olá\n- item\n```'
    expect(cleanPolishedText(raw)).toBe('## Olá\n- item')
  })

  it('remove cerca de código envolvente com linguagem (markdown)', () => {
    const raw = '```markdown\ntexto\n```'
    expect(cleanPolishedText(raw)).toBe('texto')
  })

  it('sem cerca envolvente (cerca no meio do texto) fica intacto', () => {
    const raw = 'a\n```js\nx\n```\nb'
    expect(cleanPolishedText(raw)).toBe(raw)
  })

  it('string que só começa com ``` mas não termina fica intacta (após trim)', () => {
    const raw = '```markdown\ntexto sem fechamento'
    expect(cleanPolishedText(raw)).toBe(raw.trim())
  })

  it('string vazia (ou só espaços) retorna vazia', () => {
    expect(cleanPolishedText('   ')).toBe('')
  })

  it('cerca envolvente com espaços extras ao redor antes do trim', () => {
    const raw = '  ```\nconteúdo\n```  '
    expect(cleanPolishedText(raw)).toBe('conteúdo')
  })
})

describe('buildPolishPrompt', () => {
  it('contém o texto original para description', () => {
    const prompt = buildPolishPrompt('Texto original da descrição', 'description')
    expect(prompt).toContain('Texto original da descrição')
  })

  it('contém o texto original para comment', () => {
    const prompt = buildPolishPrompt('Texto original do comentário', 'comment')
    expect(prompt).toContain('Texto original do comentário')
  })

  it('menciona markdown nas instruções', () => {
    const prompt = buildPolishPrompt('texto', 'description')
    expect(prompt.toLowerCase()).toContain('markdown')
  })

  it('proíbe inventar informação', () => {
    const prompt = buildPolishPrompt('texto', 'description')
    const lower = prompt.toLowerCase()
    expect(lower.includes('invent') || lower.includes('inventar')).toBe(true)
  })

  it('instrui a manter chaves de card (ex.: BT-123)', () => {
    const prompt = buildPolishPrompt('texto', 'description')
    const lower = prompt.toLowerCase()
    expect(lower.includes('bt-123') || lower.includes('chaves') || lower.includes('keys')).toBe(
      true
    )
  })

  it('prompt de comment menciona comentário', () => {
    const prompt = buildPolishPrompt('texto', 'comment')
    expect(prompt.toLowerCase()).toContain('coment')
  })

  it('prompts de description e comment são diferentes entre si', () => {
    const promptDescription = buildPolishPrompt('mesmo texto', 'description')
    const promptComment = buildPolishPrompt('mesmo texto', 'comment')
    expect(promptDescription).not.toBe(promptComment)
  })
})
