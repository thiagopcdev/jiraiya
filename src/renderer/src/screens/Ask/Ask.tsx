import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { CheckCircle2, Send, Sparkles, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { useAiStatus, unavailableAiProviderLabel } from '../../api/hooks'
import { Button, EmptyState, ScreenHeader, Spinner } from '../../components/ui'
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

/** Quadrado de 26px com o Sparkles — marca visual de toda resposta do assistente. */
function AssistantAvatar(): React.JSX.Element {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-indigo-600/14 text-indigo-400">
      <Sparkles size={14} />
    </span>
  )
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
      <div className="flex max-w-[520px] items-center gap-2 rounded-[9px] border border-green-600/35 bg-green-600/10 px-3 py-2.5 text-[13px] text-green-400 light:text-green-600">
        <CheckCircle2 size={14} className="shrink-0" />
        {item.message}
      </div>
    )
  }

  const isError = item.status === 'error'
  const isBusy = item.status === 'busy'

  return (
    <div
      className={`max-w-[520px] rounded-[9px] border px-3 py-2.5 ${
        isError ? 'border-amber-600/35 bg-amber-600/10' : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <p className="text-[13px] text-zinc-200">
        <button
          className="font-mono text-[11.5px] text-indigo-400 hover:underline"
          onClick={() => onOpenIssue(item.action.key)}
        >
          {item.action.key}
        </button>
        {': '}
        {actionDescription(item.action)}
      </p>
      {isError && item.message && (
        <p className="mt-1 text-[11.5px] text-amber-400 light:text-amber-600">{item.message}</p>
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

/** Três pontinhos de 6px no lugar de spinner + texto — o rótulo fica só para leitor de tela. */
function WaitingDots(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" role="status">
      <span className="size-1.5 animate-pulse rounded-full bg-indigo-400" />
      <span className="size-1.5 animate-pulse rounded-full bg-zinc-700 [animation-delay:200ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-zinc-700 [animation-delay:400ms]" />
      <span className="sr-only">{t.ask.thinking}</span>
    </div>
  )
}

export default function Ask(): React.JSX.Element {
  const { data: aiStatus } = useAiStatus()

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

  // Contexto do cabeçalho: quem responde + de onde vem a resposta.
  const headerContext = [aiStatus?.active?.label, t.ask.hint].filter(Boolean).join(' · ')

  if (aiStatus && !aiStatus.active) {
    return (
      <div className="flex h-full flex-col">
        <ScreenHeader title={t.ask.title} context={t.ask.hint} />
        <EmptyState message={t.ask.aiUnavailableHint(unavailableAiProviderLabel(aiStatus))} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title={t.ask.title}
        context={headerContext}
        actions={
          messages.length > 0 && (
            <Button variant="secondary" onClick={clearConversation}>
              <Trash2 size={12} />
              {t.ask.clearConversation}
            </Button>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 && !busy ? (
          <div className="flex h-full flex-col items-center justify-center gap-3.5">
            <div className="flex size-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900">
              <Sparkles size={20} className="text-indigo-400" />
            </div>
            <p className="max-w-[46ch] text-center text-[13px] text-zinc-500">{t.ask.emptyTitle}</p>
          </div>
        ) : (
          <div className="flex max-w-[780px] flex-col gap-4">
            {messages.map((message, i) =>
              message.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[70%] rounded-[10px_10px_2px_10px] bg-indigo-600/14 px-3 py-2.5 text-[13.5px] leading-[1.55] text-zinc-200">
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <AssistantAvatar />
                  <div className="flex min-w-0 flex-col gap-2.5">
                    {message.error ? (
                      <div className="max-w-[520px] rounded-[9px] border border-amber-600/35 bg-amber-600/10 px-3 py-2.5 text-[13px] text-amber-400 light:text-amber-600">
                        {message.content}
                      </div>
                    ) : (
                      <div className="max-w-[70ch]">
                        <MarkdownLite text={message.content} variant="chat" />
                      </div>
                    )}
                    {!message.error && message.actionItems && message.actionItems.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-[11.5px] text-zinc-500">
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
                </div>
              )
            )}
            {busy && (
              <div className="flex gap-2.5">
                <AssistantAvatar />
                <div className="flex h-[26px] items-center">
                  <WaitingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/60 px-6 py-3">
        <div className="flex max-w-[780px] flex-col gap-2">
          {/* Atalho de partida: some depois da primeira pergunta, quando a conversa
              já dá o contexto e os chips só ocupariam espaço. */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {t.ask.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  disabled={busy}
                  className="rounded-full border border-zinc-800 px-3 py-0.5 text-[11.5px] text-zinc-400 transition-colors hover:border-indigo-600/60 hover:text-indigo-400 disabled:cursor-not-allowed"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              className="h-[38px] max-h-40 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-[7px] text-[13px] leading-[1.6] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500"
              placeholder={t.ask.placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button disabled={busy || !input.trim()} onClick={() => void send(input)}>
              {busy ? <Spinner /> : <Send size={13} />}
              {t.ask.send}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
