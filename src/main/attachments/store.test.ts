import { beforeEach, describe, expect, it, vi } from 'vitest'

// store.ts importa 'electron' (getPath para temp dir). Sob ELECTRON_RUN_AS_NODE
// isso pode nem resolver como módulo — mockamos antes do import para garantir.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/fake') }
}))

const { AttachmentCache } = await import('./store')

describe('AttachmentCache', () => {
  it('set/get roundtrip', () => {
    const cache = new AttachmentCache()
    const data = Buffer.from('conteúdo')
    cache.set('a', { data, mimeType: 'application/pdf' })

    expect(cache.get('a')).toEqual({ data, mimeType: 'application/pdf' })
  })

  it('miss → null', () => {
    const cache = new AttachmentCache()
    expect(cache.get('inexistente')).toBeNull()
  })

  it('mimeType null é preservado', () => {
    const cache = new AttachmentCache()
    cache.set('a', { data: Buffer.from('x'), mimeType: null })
    expect(cache.get('a')).toEqual({ data: Buffer.from('x'), mimeType: null })
  })

  describe('evicção por maxEntries', () => {
    it('maxEntries 2, insere 3 → o 1º sai, os 2 últimos ficam', () => {
      const cache = new AttachmentCache({ maxEntries: 2 })
      cache.set('a', { data: Buffer.from('a'), mimeType: null })
      cache.set('b', { data: Buffer.from('b'), mimeType: null })
      cache.set('c', { data: Buffer.from('c'), mimeType: null })

      expect(cache.get('a')).toBeNull()
      expect(cache.get('b')).toEqual({ data: Buffer.from('b'), mimeType: null })
      expect(cache.get('c')).toEqual({ data: Buffer.from('c'), mimeType: null })
    })

    it('LRU real: maxEntries 2, set A, set B, get A, set C → B sai e A fica', () => {
      const cache = new AttachmentCache({ maxEntries: 2 })
      cache.set('a', { data: Buffer.from('a'), mimeType: null })
      cache.set('b', { data: Buffer.from('b'), mimeType: null })
      cache.get('a') // toca recência de A — B vira o menos recente
      cache.set('c', { data: Buffer.from('c'), mimeType: null })

      expect(cache.get('b')).toBeNull()
      expect(cache.get('a')).toEqual({ data: Buffer.from('a'), mimeType: null })
      expect(cache.get('c')).toEqual({ data: Buffer.from('c'), mimeType: null })
    })
  })

  describe('evicção por maxBytes', () => {
    it('evicta o menos recente até caber em maxBytes', () => {
      const cache = new AttachmentCache({ maxBytes: 10 })
      cache.set('a', { data: Buffer.alloc(6, 'a'), mimeType: null }) // 6 bytes
      cache.set('b', { data: Buffer.alloc(6, 'b'), mimeType: null }) // 6 bytes — total 12 > 10

      expect(cache.get('a')).toBeNull()
      expect(cache.get('b')).toEqual({ data: Buffer.alloc(6, 'b'), mimeType: null })
      expect(cache.totalBytes).toBe(6)
    })

    it('item maior que maxBytes sozinho não entra no cache e não evicta os existentes', () => {
      const cache = new AttachmentCache({ maxBytes: 10 })
      cache.set('a', { data: Buffer.alloc(4, 'a'), mimeType: null })
      cache.set('b', { data: Buffer.alloc(4, 'b'), mimeType: null })

      cache.set('big', { data: Buffer.alloc(20, 'x'), mimeType: null })

      expect(cache.get('big')).toBeNull()
      expect(cache.get('a')).toEqual({ data: Buffer.alloc(4, 'a'), mimeType: null })
      expect(cache.get('b')).toEqual({ data: Buffer.alloc(4, 'b'), mimeType: null })
      expect(cache.totalBytes).toBe(8)
    })
  })

  describe('clear()', () => {
    it('zera totalBytes e remove todas as entradas', () => {
      const cache = new AttachmentCache()
      cache.set('a', { data: Buffer.alloc(5), mimeType: null })
      cache.set('b', { data: Buffer.alloc(5), mimeType: null })

      cache.clear()

      expect(cache.totalBytes).toBe(0)
      expect(cache.get('a')).toBeNull()
      expect(cache.get('b')).toBeNull()
    })
  })

  describe('totalBytes', () => {
    it('soma os tamanhos dos buffers armazenados', () => {
      const cache = new AttachmentCache()
      expect(cache.totalBytes).toBe(0)

      cache.set('a', { data: Buffer.alloc(3), mimeType: null })
      expect(cache.totalBytes).toBe(3)

      cache.set('b', { data: Buffer.alloc(7), mimeType: null })
      expect(cache.totalBytes).toBe(10)
    })
  })
})

describe('AttachmentCache — defaults', () => {
  let cache: InstanceType<typeof AttachmentCache>

  beforeEach(() => {
    cache = new AttachmentCache()
  })

  it('aceita maxEntries default de 30 sem estourar antes disso', () => {
    for (let i = 0; i < 30; i++) {
      cache.set(`k${i}`, { data: Buffer.from(String(i)), mimeType: null })
    }
    expect(cache.get('k0')).not.toBeNull()
    expect(cache.get('k29')).not.toBeNull()
  })
})
