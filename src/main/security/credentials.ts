import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'

/**
 * Credenciais sempre criptografadas via safeStorage (Keychain no macOS).
 * Se a criptografia não estiver disponível, recusa — nunca plaintext.
 */

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function storeCredential(
  db: Database.Database,
  workspaceId: number,
  type: string,
  value: string
): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Criptografia do sistema indisponível — credencial não será salva')
  }
  const encrypted = safeStorage.encryptString(value)
  db.prepare(
    `INSERT INTO integration_credential (workspace_id, type, encrypted_value, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(workspaceId, type, encrypted, new Date().toISOString())
}

export function getCredential(
  db: Database.Database,
  workspaceId: number,
  type: string
): string | null {
  const row = db
    .prepare(
      `SELECT encrypted_value FROM integration_credential
       WHERE workspace_id = ? AND type = ? ORDER BY id DESC LIMIT 1`
    )
    .get(workspaceId, type) as { encrypted_value: Buffer } | undefined
  if (!row) return null
  return safeStorage.decryptString(row.encrypted_value)
}

export function deleteCredentials(db: Database.Database, workspaceId: number): void {
  db.prepare('DELETE FROM integration_credential WHERE workspace_id = ?').run(workspaceId)
}
