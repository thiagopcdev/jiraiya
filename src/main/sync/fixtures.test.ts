import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { deriveActivities } from './deriveActivities'
import type { JiraBulkChangelogResponse, JiraComment } from '../jira/types'

/**
 * Testes sobre fixtures REAIS sanitizadas (tests/fixtures/*, geradas por
 * scripts/capture-fixtures.mjs). Pulam quando as fixtures não existem —
 * a suíte principal não depende delas, mas quando presentes garantem que
 * payloads reais (ex.: item de changelog sem "toString") não quebram o bind.
 */

const dir = join(__dirname, '..', '..', '..', 'tests', 'fixtures')
const changelogsPath = join(dir, 'changelogs.json')
const commentsPath = join(dir, 'comments.json')
const hasFixtures = existsSync(changelogsPath)

describe.skipIf(!hasFixtures)('fixtures reais — deriveActivities', () => {
  it('todo valor derivado é bind-safe (string ou null) e source_ids são únicos', () => {
    const bulk = JSON.parse(readFileSync(changelogsPath, 'utf8')) as JiraBulkChangelogResponse
    const commentsByIssue = existsSync(commentsPath)
      ? (JSON.parse(readFileSync(commentsPath, 'utf8')) as Array<{
          issueKey: string
          comments: JiraComment[]
        }>)
      : []

    expect(bulk.issueChangeLogs.length).toBeGreaterThan(0)

    for (const entry of bulk.issueChangeLogs) {
      const comments = commentsByIssue.find((c) => c.issueKey === entry.issueId)?.comments ?? []
      const activities = deriveActivities({
        issue: { key: `FIX-${entry.issueId}`, fields: { summary: 'fixture' } },
        changelog: entry.changeHistories,
        comments,
        storyPointsFieldId: 'customfield_10016'
      })

      const sourceIds = activities.map((a) => a.sourceId)
      expect(new Set(sourceIds).size).toBe(sourceIds.length)

      for (const a of activities) {
        for (const v of [a.fromValue, a.toValue, a.bodyText, a.field, a.actorName]) {
          expect(v === null || typeof v === 'string').toBe(true)
        }
        expect(typeof a.occurredAt).toBe('string')
        expect(Number.isNaN(new Date(a.occurredAt).getTime())).toBe(false)
      }
    }
  })
})
