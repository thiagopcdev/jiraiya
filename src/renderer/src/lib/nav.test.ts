// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readNavCollapsed, writeNavCollapsed } from './nav'

beforeEach(() => localStorage.clear())

describe('lib/nav', () => {
  it('sem nada persistido, a nav começa aberta', () => {
    expect(readNavCollapsed()).toBe(false)
  })

  it('persiste o trilho recolhido e lê de volta', () => {
    writeNavCollapsed(true)
    expect(localStorage.getItem('jiraiya.navCollapsed')).toBe('1')
    expect(readNavCollapsed()).toBe(true)
  })

  it('voltar a abrir grava o estado explícito (não apaga a chave)', () => {
    writeNavCollapsed(true)
    writeNavCollapsed(false)
    expect(localStorage.getItem('jiraiya.navCollapsed')).toBe('0')
    expect(readNavCollapsed()).toBe(false)
  })

  it('valor estranho na chave não recolhe a nav', () => {
    localStorage.setItem('jiraiya.navCollapsed', 'true')
    expect(readNavCollapsed()).toBe(false)
  })
})
