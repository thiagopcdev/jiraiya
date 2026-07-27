import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../migrations'
import { listTemplates, saveTemplate, deleteTemplate } from './templates'

function insertWorkspace(db: Database.Database, id: number, accountId: string): void {
  db.prepare(
    `INSERT INTO workspace (id, site_url, email, account_id, created_at)
     VALUES (@id, 'https://x.atlassian.net', 'e@x.com', @accountId, 'now')`
  ).run({ id, accountId })
}

describe('repo de templates (comment_template)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertWorkspace(db, 1, 'acc-1')
    insertWorkspace(db, 2, 'acc-2')
  })

  it('save sem id cria um template novo', () => {
    const created = saveTemplate(db, 1, { name: 'Template A', content: 'conteúdo A' })

    expect(created).toEqual({ id: expect.any(Number), name: 'Template A', content: 'conteúdo A' })

    const list = listTemplates(db, 1)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({ id: created.id, name: 'Template A', content: 'conteúdo A' })
  })

  it('list devolve ordenado por position,id (posições incrementam a cada save)', () => {
    const t1 = saveTemplate(db, 1, { name: 'Um', content: 'c1' })
    const t2 = saveTemplate(db, 1, { name: 'Dois', content: 'c2' })
    const t3 = saveTemplate(db, 1, { name: 'Três', content: 'c3' })

    const list = listTemplates(db, 1)
    expect(list.map((t) => t.id)).toEqual([t1.id, t2.id, t3.id])
    expect(list.map((t) => t.name)).toEqual(['Um', 'Dois', 'Três'])
  })

  it('save com id atualiza name/content (list reflete, mesma quantidade)', () => {
    const t1 = saveTemplate(db, 1, { name: 'Original', content: 'original' })
    saveTemplate(db, 1, { name: 'Outro', content: 'outro' })

    const updated = saveTemplate(db, 1, { id: t1.id, name: 'Editado', content: 'editado' })
    expect(updated).toEqual({ id: t1.id, name: 'Editado', content: 'editado' })

    const list = listTemplates(db, 1)
    expect(list).toHaveLength(2)
    const found = list.find((t) => t.id === t1.id)
    expect(found).toEqual({ id: t1.id, name: 'Editado', content: 'editado' })
  })

  it('save com id inexistente lança', () => {
    expect(() => saveTemplate(db, 1, { id: 999, name: 'X', content: 'Y' })).toThrow()
  })

  it('save com id de outro workspace lança (não atualiza silenciosamente)', () => {
    const t1 = saveTemplate(db, 1, { name: 'Do ws 1', content: 'c1' })
    expect(() => saveTemplate(db, 2, { id: t1.id, name: 'Invasão', content: 'x' })).toThrow()

    // permanece intacto no workspace original
    expect(listTemplates(db, 1)[0]).toEqual({ id: t1.id, name: 'Do ws 1', content: 'c1' })
  })

  it('delete remove o template', () => {
    const t1 = saveTemplate(db, 1, { name: 'Apagar', content: 'x' })
    saveTemplate(db, 1, { name: 'Ficar', content: 'y' })

    deleteTemplate(db, 1, t1.id)

    const list = listTemplates(db, 1)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Ficar')
  })

  it('delete de id inexistente não lança', () => {
    expect(() => deleteTemplate(db, 1, 12345)).not.toThrow()
  })

  it('isolamento por workspace_id (template do ws 2 não aparece no list do ws 1)', () => {
    saveTemplate(db, 1, { name: 'Do ws 1', content: 'c1' })
    saveTemplate(db, 2, { name: 'Do ws 2', content: 'c2' })

    const list1 = listTemplates(db, 1)
    const list2 = listTemplates(db, 2)

    expect(list1).toHaveLength(1)
    expect(list1[0].name).toBe('Do ws 1')
    expect(list2).toHaveLength(1)
    expect(list2[0].name).toBe('Do ws 2')
  })
})
