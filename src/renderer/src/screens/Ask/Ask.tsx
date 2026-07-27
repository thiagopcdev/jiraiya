import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, Sparkles, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { Button, EmptyState, Spinner } from '../../components/ui'
import { MarkdownLite } from '../../components/MarkdownLite'
import { t } from '../../strings/ptBR'
import { useIssueDetail } from '../../components/issueDetail'
import type { IpcRequest } from '@shared/ipc-contract'
import type { AskAction } from '@shared/domain'

interface ActionItem {
  action: AskAction
  status: 'idle' | 'busy' | 'done' | 'error'
  /** mensagem de sucesso (done) ou de erro (error) */
  message?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  /** ações propostas pelo assistente nesta resposta (undefined nas mensagens do usuário) */
  actionItems?: ActionItem[]
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Descrição da ação sem repetir a key (a key vira o trecho clicável do card). */
function actionDescription(action: AskAction): string {
  switch (action.type) {
    case 'move_status':
      return `Mover para "${action.statusName ?? ''}"`
    case 'assign_me':
      return 'Atribuir a você'
    case 'comment':
      return `Comentar: "${truncate(action.text ?? '', 80)}"`
    case 'log_work':
      return `Registrar ${action.timeSpent ?? ''}`
    case 'set_story_points':
      return `Story points → ${action.storyPoints ?? ''}`
    default:
      return ''
  }
}

function AskActionCard({
  item,
  onExecute,
  onDiscard,
  onOpenIssue
}: {
  item: ActionItem
  onExecute: () => void
  onDiscard: () => void
  onOpenIssue: (key: string) => void
}): React.JSX.Element {
  if (item.status === 'done') {
    return (
      <div className="rounded-md border border-green-900 bg-green-950/30 px-3 py-2 text-sm text-green-300 light:border-green-300 light:bg-green-50 light:text-green-700">
        ✓ {item.message}
      </div>
    )
  }

  const isError = item.status === 'error'
  const isBusy = item.status === 'busy'

  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        isError
          ? 'border-amber-900 bg-amber-950/30 light:border-amber-300 light:bg-amber-50'
          : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <p className="text-sm text-zinc-200">
        <button
          className="font-mono text-xs text-indigo-400 hover:underline light:text-indigo-600"
          onClick={() => onOpenIssue(item.action.key)}
        >
          {item.action.key}
        </button>
        {': '}
        {actionDescription(item.action)}
      </p>
      {isError && item.message && (
        <p className="mt-1 text-xs text-amber-400 light:text-amber-700">{item.message}</p>
      )}
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" disabled={isBusy} onClick={onExecute}>
          {isBusy && <Spinner />}
          {isBusy ? 'Executando…' : isError ? 'Tentar de novo' : 'Executar'}
        </Button>
        <Button variant="ghost" disabled={isBusy} onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </div>
  )
}

export default function Ask(): React.JSX.Element {
  const { data: claudeInfo } = useQuery({
    queryKey: ['claude-status'],
    queryFn: () => invoke('claude:status', {})
  })

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { openIssue } = useIssueDetail()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async (question: string): Promise<void> => {
    const trimmed = question.trim()
    if (!trimmed || busy) return

    // Histórico ANTES da nova pergunta (mais antiga primeiro), limitado às últimas 10 trocas.
    const history: IpcRequest<'ask:question'>['history'] = messages
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }))

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setBusy(true)
    try {
      const res = await invoke('ask:question', { question: trimmed, history })
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          actionItems: res.actions.map((action) => ({ action, status: 'idle' as const }))
        }
      ])
    } catch (err) {
      const message = err instanceof IpcError ? err.message : t.common.error
      setMessages((prev) => [...prev, { role: 'assistant', content: message, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const clearConversation = (): void => {
    setMessages([])
    setInput('')
  }

  const updateActionItem = (
    msgIndex: number,
    actionIndex: number,
    patch: Partial<ActionItem> | null
  ): void => {
    setMessages((prev) =>
      prev.map((m, i) => {
        if (i !== msgIndex || !m.actionItems) return m
        if (patch === null) {
          return { ...m, actionItems: m.actionItems.filter((_, j) => j !== actionIndex) }
        }
        return {
          ...m,
          actionItems: m.actionItems.map((item, j) =>
            j === actionIndex ? { ...item, ...patch } : item
          )
        }
      })
    )
  }

  const executeAction = async (
    msgIndex: number,
    actionIndex: number,
    action: AskAction
  ): Promise<void> => {
    updateActionItem(msgIndex, actionIndex, { status: 'busy' })
    try {
      const res = await invoke('ask:execute', { action })
      updateActionItem(msgIndex, actionIndex, { status: 'done', message: res.message })
    } catch (err) {
      const message = err instanceof IpcError ? err.message : t.common.error
      updateActionItem(msgIndex, actionIndex, { status: 'error', message })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  if (claudeInfo && !claudeInfo.available) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-6">
        <h2 className="text-xl font-semibold text-zinc-100">{t.ask.title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t.ask.hint}</p>
        <EmptyState message={t.ask.claudeUnavailableHint} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">{t.ask.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t.ask.hint}</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" onClick={clearConversation}>
            <Trash2 size={14} />
            {t.ask.clearConversation}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900">
              <Sparkles size={20} className="text-indigo-400 light:text-indigo-600" />
            </div>
            <p className="text-sm text-zinc-500">{t.ask.emptyTitle}</p>
            <div className="flex max-w-lg flex-col items-center gap-2">
              {t.ask.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-indigo-700 hover:text-indigo-300 light:hover:text-indigo-600"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, i) =>
            message.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-indigo-950/60 px-3 py-2 text-sm text-zinc-100">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start gap-2">
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 ${
                    message.error
                      ? 'border-amber-900 bg-amber-950/30 text-amber-300 light:border-amber-300 light:bg-amber-50 light:text-amber-700'
                      : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  {message.error ? (
                    <p className="text-sm">{message.content}</p>
                  ) : (
                    <MarkdownLite text={message.content} />
                  )}
                </div>
                {!message.error && message.actionItems && message.actionItems.length > 0 && (
                  <div className="flex w-full max-w-[85%] flex-col gap-2">
                    <p className="text-xs text-zinc-500">
                      Ações só executam com a sua confirmação.
                    </p>
                    {message.actionItems.map((item, j) => (
                      <AskActionCard
                        key={j}
                        item={item}
                        onExecute={() => void executeAction(i, j, item.action)}
                        onDiscard={() => updateActionItem(i, j, null)}
                        onOpenIssue={openIssue}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          )
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="flex max-w-[85%] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400">
              <Spinner />
              {t.ask.thinking}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="h-16 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 outline-none focus:border-indigo-600"
          placeholder={t.ask.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button disabled={busy || !input.trim()} onClick={() => void send(input)}>
          {busy ? <Spinner /> : <Send size={14} />}
          {t.ask.send}
        </Button>
      </div>
    </div>
  )
}
