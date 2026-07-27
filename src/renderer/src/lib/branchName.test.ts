import { describe, expect, it } from 'vitest'
import { branchName } from './branchName'

describe('branchName', () => {
  it("issueType 'História' → prefixo feat e slug normalizado", () => {
    expect(branchName('História', 'BT-10', 'Criar relatório de vendas')).toBe(
      'feat/BT-10-criar-relatorio-de-vendas'
    )
  })

  it('issueType Bug com blocos [..] no início do summary → prefixo fix, slug sem os blocos, até 40 chars', () => {
    const result = branchName(
      'Bug',
      'BT-806',
      '[Segurança] Endpoint público permite trocar telefone'
    )
    expect(result.startsWith('fix/BT-806-endpoint-publico')).toBe(true)

    const slug = result.slice('fix/BT-806-'.length)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('issueType null → prefixo feat', () => {
    expect(branchName(null, 'BT-5', 'Ajustar layout')).toBe('feat/BT-5-ajustar-layout')
  })

  it("issueType 'defeito' → prefixo fix", () => {
    expect(branchName('defeito', 'BT-7', 'Corrigir crash')).toBe('fix/BT-7-corrigir-crash')
  })

  it("issueType 'BUG' em caixa alta → prefixo fix", () => {
    expect(branchName('BUG', 'BT-8', 'Corrigir crash')).toBe('fix/BT-8-corrigir-crash')
  })

  it('summary só com blocos [X][Y] + acentos/símbolos → blocos removidos, acentos e símbolos normalizados', () => {
    expect(branchName(null, 'BT-1', '[A][B] Ção!!! à~ê')).toBe('feat/BT-1-cao-a-e')
  })
})
