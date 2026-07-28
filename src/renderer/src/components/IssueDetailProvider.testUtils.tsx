import type { Issue } from '@shared/domain'
import type { Workspace } from '@shared/domain'
import { useIssueDetail } from './issueDetail'
import type { MockHandlers } from '../testing/mockApi'

/**
 * Fixtures e handlers-base compartilhados pelos testes de IssueDetailProvider
 * (core/comments/edit/sections/pending). Cada arquivo de teste importa
 * `baseHandlers()` e sobrescreve só os canais que precisa customizar via
 * `api.set(...)` depois de `installMockApi(baseHandlers(...))`.
 *
 * Arquivo de suporte a teste (não é módulo de produção): mistura de props
 * livremente com o componente-sonda, sem se preocupar com Fast Refresh.
 */
/* eslint-disable react-refresh/only-export-components */

export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    jiraId: '10001',
    key: 'BT-1',
    projectKey: 'BT',
    summary: 'Corrigir bug no login',
    descriptionText: null,
    issueType: 'Tarefa',
    status: 'A fazer',
    statusCategory: 'new',
    priority: 'Média',
    assigneeAccountId: null,
    assigneeName: null,
    reporterAccountId: null,
    storyPoints: null,
    sprintJiraId: null,
    labels: [],
    parentKey: null,
    flagged: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    resolvedAt: null,
    url: 'https://biudtecnologia.atlassian.net/browse/BT-1',
    ...overrides
  }
}

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 1,
    siteUrl: 'https://biudtecnologia.atlassian.net',
    email: 'thiagocarvalho@biud.com.br',
    accountId: 'acc-me',
    displayName: 'Thiago Prado',
    timeZone: 'America/Sao_Paulo',
    ...overrides
  }
}

/**
 * Conjunto mínimo de canais que a gaveta chama sempre que abre um card (estado
 * default: seção Editar/Histórico/Timeline fechadas). Passe `issue` para
 * controlar o card retornado por `issues:get`; os demais são sobrescrevíveis
 * via `api.set(...)` depois de instalar.
 */
export function baseHandlers(issue: Issue = makeIssue()): MockHandlers {
  return {
    'queue:list': () => ({ actions: [] }),
    'issues:get': () => ({ issue }),
    'issues:activity': () => ({ activities: [] }),
    'issues:comments': () => ({ comments: [] }),
    'issues:description': () => ({ description: null, markdown: null }),
    'ai:status': () => ({ providers: [], active: null, activePref: 'auto' }),
    'sprint:list': () => ({ sprints: [] }),
    'issues:transitions': () => ({ transitions: [] }),
    'issues:children': () => ({ issues: [] }),
    'issues:links': () => ({ links: [] }),
    'issueTypes:list': () => ({ issueTypes: [] }),
    'auth:status': () => ({ connected: true, workspace: makeWorkspace() }),
    'issues:attachments': () => ({ attachments: [] }),
    'watch:status': () => ({ watching: false }),
    'prs:status': () => ({ ghAvailable: false, enabled: false }),
    'notes:get': () => ({ content: null, updatedAt: null }),
    'export:clipboard': () => ({ ok: true }),
    'shell:openIssue': () => ({ ok: true })
  }
}

/** Componente-sonda: abre (ou reabre) um card na gaveta via useIssueDetail(). */
export function OpenIssueButton({ issueKey }: { issueKey: string }): React.JSX.Element {
  const { openIssue } = useIssueDetail()
  return (
    <button type="button" onClick={() => openIssue(issueKey)}>
      abrir {issueKey}
    </button>
  )
}
