import { join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function openDb(filePath?: string): Database.Database {
  if (db) return db
  const path = filePath ?? join(app.getPath('userData'), 'jiraiya.db')
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB não inicializado — chame openDb() no boot')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
