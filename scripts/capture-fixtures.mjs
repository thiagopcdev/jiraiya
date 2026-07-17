#!/usr/bin/env node
/**
 * Captura fixtures REAIS da API do Jira e grava versões sanitizadas em
 * tests/fixtures/. Rode manualmente (o token nunca entra no repo):
 *
 *   JIRA_SITE=https://suaempresa.atlassian.net \
 *   JIRA_EMAIL=voce@empresa.com \
 *   JIRA_TOKEN=xxxx \
 *   node scripts/capture-fixtures.mjs [JQL opcional]
 *
 * Sanitização: nomes/emails viram pseudônimos, resumos e textos viram
 * placeholders — a ESTRUTURA (campos presentes/ausentes, tipos) é preservada,
 * que é o que os testes precisam (ex.: item de changelog sem "toString").
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const site = process.env.JIRA_SITE?.replace(/\/$/, '')
const email = process.env.JIRA_EMAIL
const token = process.env.JIRA_TOKEN
if (!site || !email || !token) {
  console.error('Defina JIRA_SITE, JIRA_EMAIL e JIRA_TOKEN. Veja o cabeçalho do script.')
  process.exit(1)
}
const jql = process.argv[2] ?? 'updated >= -14d ORDER BY updated DESC'

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
async function call(method, path, body) {
  const res = await fetch(site + path, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok)
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// ---- sanitização ----
const nameMap = new Map()
function pseudonym(accountId, kind = 'Pessoa') {
  if (!accountId) return null
  if (!nameMap.has(accountId)) nameMap.set(accountId, `${kind} ${nameMap.size + 1}`)
  return nameMap.get(accountId)
}
function sanitizeUser(u) {
  if (!u || typeof u !== 'object') return u
  const out = {
    accountId: `acc-${[...nameMap.keys()].indexOf(u.accountId) + 1 || nameMap.size + 1}`
  }
  out.displayName = pseudonym(u.accountId)
  // preserva presença/ausência de campos sem vazar dados
  if ('emailAddress' in u) out.emailAddress = 'pessoa@example.com'
  return out
}
function sanitizeAdf(node) {
  if (!node || typeof node !== 'object') return node
  const out = { ...node }
  if (out.type === 'text' && typeof out.text === 'string') out.text = 'texto sanitizado'
  if (out.attrs?.text) out.attrs = { ...out.attrs, text: '@Pessoa' }
  if (Array.isArray(out.content)) out.content = out.content.map(sanitizeAdf)
  return out
}
function sanitizeChangelogHistory(h) {
  return {
    ...h,
    author: sanitizeUser(h.author),
    items: h.items?.map((item) => {
      const out = { ...item }
      // preserva exatamente quais chaves existem (from/fromString/to/toString)
      for (const k of ['from', 'fromString', 'to', 'toString']) {
        if (k in out && typeof out[k] === 'string' && out[k].length > 0) {
          out[k] = /^\d+$/.test(out[k]) ? out[k] : `valor ${k}`
        }
      }
      return out
    })
  }
}

// ---- captura ----
const outDir = join(process.cwd(), 'tests', 'fixtures')
mkdirSync(outDir, { recursive: true })

const search = await call('POST', '/rest/api/3/search/jql', {
  jql,
  maxResults: 10,
  fields: ['summary', 'status', 'assignee', 'reporter', 'created', 'updated', 'labels', 'priority']
})
const issues = search.issues ?? []
console.log(`search: ${issues.length} issues`)

const sanitizedSearch = {
  ...search,
  issues: issues.map((i, idx) => ({
    ...i,
    fields: {
      ...i.fields,
      summary: `Issue sanitizada ${idx + 1}`,
      assignee: sanitizeUser(i.fields.assignee),
      reporter: sanitizeUser(i.fields.reporter),
      labels: (i.fields.labels ?? []).map((_, li) => `label-${li + 1}`)
    }
  }))
}
writeFileSync(join(outDir, 'search.json'), JSON.stringify(sanitizedSearch, null, 2))

const keys = issues.map((i) => i.key)
if (keys.length > 0) {
  const bulk = await call('POST', '/rest/api/3/changelog/bulkfetch', {
    issueIdsOrKeys: keys,
    maxResults: 1000
  })
  const sanitizedBulk = {
    ...bulk,
    issueChangeLogs: (bulk.issueChangeLogs ?? []).map((entry) => ({
      ...entry,
      changeHistories: (entry.changeHistories ?? []).map(sanitizeChangelogHistory)
    }))
  }
  writeFileSync(join(outDir, 'changelogs.json'), JSON.stringify(sanitizedBulk, null, 2))
  console.log(`changelogs: ${sanitizedBulk.issueChangeLogs.length} issues`)

  const comments = []
  for (const key of keys.slice(0, 3)) {
    const res = await call(
      'GET',
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=20`
    )
    comments.push({
      issueKey: key,
      comments: (res.comments ?? []).map((c) => ({
        ...c,
        author: sanitizeUser(c.author),
        body: sanitizeAdf(c.body)
      }))
    })
  }
  writeFileSync(join(outDir, 'comments.json'), JSON.stringify(comments, null, 2))
  console.log(`comments: ${comments.length} issues`)
}

console.log(`fixtures gravadas em ${outDir} — revise antes de commitar.`)
