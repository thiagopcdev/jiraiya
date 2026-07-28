import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** userData isolado por execução: o log real fica em <userData>/logs. */
const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const base = (await import('../testing/electronMock')).createElectronMock()
  return { ...base, app: { ...(base.app as object), getPath: () => userData.dir } }
})

userData.dir = mkdtempSync(join(tmpdir(), 'jiraiya-reqlog-'))

const { logJiraRequest } = await import('./requestLog')

const LOG = (): string => join(userData.dir, 'logs', 'jira-requests.log')

afterAll(() => {
  rmSync(userData.dir, { recursive: true, force: true })
})

describe('logJiraRequest', () => {
  beforeEach(() => {
    // só os arquivos: o caminho do log é memoizado no módulo, o diretório fica
    rmSync(LOG(), { force: true })
    rmSync(`${LOG()}.1`, { force: true })
  })

  it('cria o diretório de logs e escreve a linha com timestamp ISO', () => {
    logJiraRequest('GET /rest/api/3/myself 200')

    const content = readFileSync(LOG(), 'utf8')
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z GET \/rest\/api\/3\/myself 200\n$/)
  })

  it('acumula linhas em append', () => {
    logJiraRequest('primeira')
    logJiraRequest('segunda')

    const lines = readFileSync(LOG(), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('primeira')
    expect(lines[1]).toContain('segunda')
  })

  it('rotaciona para .log.1 quando o arquivo passa de ~5MB', () => {
    logJiraRequest('primeira linha para criar o arquivo')
    writeFileSync(LOG(), 'x'.repeat(5 * 1024 * 1024 + 10))

    // a checagem de tamanho acontece a cada 50 escritas
    for (let i = 0; i < 60; i++) logJiraRequest(`linha ${i}`)

    expect(existsSync(`${LOG()}.1`)).toBe(true)
    const rotated = readFileSync(`${LOG()}.1`, 'utf8')
    expect(rotated.startsWith('xxx')).toBe(true)
    expect(readFileSync(LOG(), 'utf8')).toContain('linha')
    expect(readFileSync(LOG(), 'utf8').length).toBeLessThan(5 * 1024 * 1024)
  })

  it('falha de escrita é silenciosa (log é best-effort)', () => {
    // diretório removido e substituído por um arquivo: appendFileSync falha
    rmSync(join(userData.dir, 'logs'), { recursive: true, force: true })
    writeFileSync(join(userData.dir, 'logs'), 'sou um arquivo, não um diretório')

    expect(() => logJiraRequest('não deve lançar')).not.toThrow()

    rmSync(join(userData.dir, 'logs'), { force: true })
  })
})
