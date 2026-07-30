import { Notification } from 'electron'
import type Database from 'better-sqlite3'
import type { AiGeneratedBy } from '@shared/domain'
import { resolvePeriod } from '@shared/periods'
import { getPrefs, saveSummary } from './db/repos/misc'
import { getWorkspaceRow } from './db/repos/workspace'
import { buildPeriodDigest, collectPeriodComments } from './summaries/selectors'
import { templates } from './summaries/templates'
import { activeProvider } from './ai/service'
import { enhanceSummary } from './ai/prompts'

/** Data local YYYY-MM-DD (America/Sao_Paulo implícito via locale do sistema). */
function localDate(d: Date): string {
  return d.toLocaleDateString('sv')
}

/** Pura: roda o briefing se ainda não rodou hoje (compara YYYY-MM-DD local). */
export function shouldRunBriefing(lastRunDate: string | null, now: Date): boolean {
  return lastRunDate !== localDate(now)
}

function getPref(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value_json FROM user_pref WHERE key = ?`).get(key) as
    { value_json: string } | undefined
  return row?.value_json ?? null
}

function setPref(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_pref (key, value_json) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(key, value)
}

/**
 * Execução em andamento. A idempotência por data só grava 'lastBriefingDate' no
 * fim, depois do await da IA (segundos) — e o briefing é disparado tanto no fim
 * do sync quanto num timer do boot, então os dois disparos caíam na janela do
 * await e geravam a daily duas vezes.
 */
let running = false

/**
 * Gera a daily de ONTEM no primeiro boot do dia, salva como summary e notifica.
 * Idempotente pela data (user_pref 'lastBriefingDate'). Falhas da IA caem no
 * template determinístico.
 *
 * `aiAvailable` é lazy: o provider pode ficar disponível depois do boot (chave
 * do OpenRouter configurada em Ajustes), então avalia a cada execução.
 */
export async function runMorningBriefing(
  db: Database.Database,
  ctx: { push: (summary: { summaryId: number }) => void },
  deps: { aiAvailable: () => boolean; showWindow: () => void }
): Promise<void> {
  if (running) return
  running = true
  try {
    const prefs = getPrefs(db)
    if (!prefs.morningBriefing) return

    const today = localDate(new Date())
    if (!shouldRunBriefing(getPref(db, 'lastBriefingDate'), new Date())) return

    const workspace = getWorkspaceRow(db)
    if (!workspace) return

    const range = resolvePeriod({ type: 'yesterday' }, new Date())
    const digest = buildPeriodDigest(db, workspace, range, prefs.stalledDays)
    let contentMd = templates.standup(digest)
    let generatedBy: AiGeneratedBy = 'template'

    const provider = deps.aiAvailable() ? activeProvider() : null
    if (provider) {
      try {
        const comentariosDoPeriodo = collectPeriodComments(db, workspace, range)
        contentMd = await enhanceSummary({
          templateMarkdown: contentMd,
          digestJson: JSON.stringify({ ...digest, comentariosDoPeriodo }, null, 2)
        })
        generatedBy = provider.id
      } catch {
        // fallback silencioso pro template
      }
    }

    const summaryId = saveSummary(db, workspace.id, {
      periodType: 'yesterday',
      periodStart: range.start,
      periodEnd: range.end,
      template: 'standup',
      contentMd,
      generatedBy
    })

    setPref(db, 'lastBriefingDate', today)
    setPref(db, 'lastBriefingSummaryId', String(summaryId))

    ctx.push({ summaryId })

    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Jiraiya', body: 'Sua daily está pronta' })
      n.on('click', () => deps.showWindow())
      n.show()
    }
  } finally {
    // libera o guard mesmo se buildPeriodDigest/saveSummary lançar
    running = false
  }
}
