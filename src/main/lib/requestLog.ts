import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Log rotativo das chamadas HTTP ao Jira, para debug de sync.
 * userData/logs/jira-requests.log; rotaciona em ~5MB mantendo 1 arquivo anterior.
 * Nunca derruba o app — falha de log é silenciosa.
 */

const MAX_BYTES = 5 * 1024 * 1024
let logPath: string | null = null
let writesSinceCheck = 0

function ensurePath(): string {
  if (!logPath) {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'jira-requests.log')
  }
  return logPath
}

export function logJiraRequest(line: string): void {
  try {
    const path = ensurePath()
    if (writesSinceCheck++ % 50 === 0 && existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
    appendFileSync(path, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // log é best-effort
  }
}
