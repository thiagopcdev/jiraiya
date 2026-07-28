import type { AskAction } from '@shared/domain'
import { AppError, handle } from '../registry'
import type { AppContext } from '../../appContext'
import { getWorkspaceRow } from '../../db/repos/workspace'
import { getPrefs } from '../../db/repos/misc'
import { updateIssueFields, updateIssueStatus } from '../../db/repos/issue'
import { markdownToAdf } from '../../issues/markdownToAdf'
import { JiraHttpError } from '../../jira/http'
import { activeProvider } from '../../ai/service'
import { buildAskContext } from '../../ask/context'
import { askJiraiya } from '../../ask/ask'
import { parseCreateError } from './create'

function requireWorkspace(ctx: AppContext): NonNullable<ReturnType<typeof getWorkspaceRow>> {
  const workspace = getWorkspaceRow(ctx.db)
  if (!workspace) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return workspace
}

function requireClient(ctx: AppContext): NonNullable<ReturnType<typeof ctx.getClient>> {
  const client = ctx.getClient()
  if (!client) throw new AppError('NOT_CONNECTED', 'Nenhuma conta Jira conectada')
  return client
}

/** Traduz recusas do Jira em AppError legível (mesmo padrão dos handlers de edição). */
function rejectJira(err: unknown, code: string, prefix: string): never {
  if (err instanceof JiraHttpError) {
    throw new AppError(code, `${prefix}: ${parseCreateError(err)}`)
  }
  throw err
}

export function registerAskHandlers(ctx: AppContext): void {
  handle('ask:question', async ({ question, history }) => {
    const workspace = requireWorkspace(ctx)
    const provider = activeProvider()
    if (!provider) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'Nenhum provider de IA disponível — configure em Ajustes'
      )
    }
    const prefs = getPrefs(ctx.db)
    const { snapshotJson } = buildAskContext(
      ctx.db,
      { id: workspace.id, account_id: workspace.account_id, site_url: workspace.site_url },
      prefs.stalledDays
    )
    try {
      const { answer, actions } = await askJiraiya({
        question,
        history,
        snapshotJson,
        todayIso: new Date().toISOString().slice(0, 10)
      })
      return { answer, generatedBy: provider.id, actions }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Não foi possível responder (${provider.label})`
      throw new AppError('AI_UNAVAILABLE', message)
    }
  })

  // executa UMA ação já confirmada pelo usuário na UI
  handle('ask:execute', async ({ action }) => {
    const workspace = requireWorkspace(ctx)
    const client = requireClient(ctx)
    const key = action.key.trim().toUpperCase()

    const message = await executeAction(ctx, workspace, client, { ...action, key })
    void ctx.scheduler?.trigger({})
    return { ok: true as const, message }
  })

  // briefing: consulta o estado do briefing do dia (a geração roda em background)
  handle('briefing:today', () => {
    const stmt = ctx.db.prepare(`SELECT value_json FROM user_pref WHERE key = ?`)
    const read = (key: string): string | null =>
      (stmt.get(key) as { value_json: string } | undefined)?.value_json ?? null
    const lastDate = read('lastBriefingDate')
    const lastId = read('lastBriefingSummaryId')
    const today = new Date().toLocaleDateString('sv')
    if (lastDate === today && lastId !== null) {
      return { summaryId: Number(lastId) }
    }
    return { summaryId: null }
  })
}

type Workspace = NonNullable<ReturnType<typeof getWorkspaceRow>>
type Client = NonNullable<ReturnType<AppContext['getClient']>>

/** Executa a ação confirmada e devolve a mensagem de confirmação pro usuário. */
async function executeAction(
  ctx: AppContext,
  workspace: Workspace,
  client: Client,
  action: AskAction
): Promise<string> {
  const key = action.key

  switch (action.type) {
    case 'move_status': {
      const wanted = action.statusName?.trim()
      if (!wanted) {
        throw new AppError('VALIDATION', 'Ação sem status de destino')
      }
      const transitions = await client.issueTransitions(key)
      const picked = transitions.find(
        (t) =>
          t.toStatusName.toLowerCase() === wanted.toLowerCase() ||
          t.name.toLowerCase() === wanted.toLowerCase()
      )
      if (!picked) {
        const options = transitions.map((t) => t.toStatusName).filter((n) => n !== '')
        throw new AppError(
          'NO_TRANSITION',
          options.length > 0
            ? `${key} não tem transição para "${wanted}". Destinos possíveis: ${options.join(', ')}`
            : `${key} não tem transições disponíveis no momento`
        )
      }
      try {
        await client.doTransition(key, picked.id)
      } catch (err) {
        rejectJira(err, 'TRANSITION_FAILED', 'O Jira recusou a transição')
      }
      updateIssueStatus(ctx.db, workspace.id, key, picked.toStatusName, picked.toCategoryKey)
      return `${key} movido para ${picked.toStatusName}`
    }

    case 'assign_me': {
      try {
        await client.updateIssue(key, { assignee: { id: workspace.account_id } })
      } catch (err) {
        rejectJira(err, 'UPDATE_FAILED', 'O Jira recusou a atribuição')
      }
      updateIssueFields(ctx.db, workspace.id, key, {
        assigneeAccountId: workspace.account_id,
        assigneeName: workspace.display_name
      })
      return `${key} atribuído a você`
    }

    case 'comment': {
      const text = action.text?.trim()
      if (!text) {
        throw new AppError('VALIDATION', 'Ação de comentário sem texto')
      }
      try {
        await client.addComment(key, markdownToAdf(text))
      } catch (err) {
        rejectJira(err, 'COMMENT_FAILED', 'O Jira recusou o comentário')
      }
      return `Comentário publicado em ${key}`
    }

    case 'log_work': {
      const timeSpent = action.timeSpent?.trim()
      if (!timeSpent) {
        throw new AppError('VALIDATION', 'Ação de registro de tempo sem duração')
      }
      try {
        await client.addWorklog(key, timeSpent)
      } catch (err) {
        rejectJira(err, 'WORKLOG_FAILED', 'O Jira recusou o registro')
      }
      return `${timeSpent} registrado em ${key}`
    }

    case 'set_story_points': {
      const storyPoints = action.storyPoints
      if (storyPoints === undefined) {
        throw new AppError('VALIDATION', 'Ação sem valor de story points')
      }
      const spFieldId = workspace.story_points_field_id
      if (!spFieldId || spFieldId === 'none') {
        throw new AppError(
          'NO_STORY_POINTS_FIELD',
          'Campo de story points não configurado neste workspace'
        )
      }
      try {
        await client.updateIssue(key, { [spFieldId]: storyPoints })
      } catch (err) {
        rejectJira(err, 'UPDATE_FAILED', 'O Jira recusou a edição')
      }
      updateIssueFields(ctx.db, workspace.id, key, { storyPoints })
      return `${key} com ${storyPoints} story points`
    }
  }
}
