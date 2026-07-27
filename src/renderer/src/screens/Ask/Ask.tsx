import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, Sparkles, Trash2 } from 'lucide-react'
import { invoke, IpcError } from '../../api/client'
import { Button, EmptyState, Spinner } from '../../components/ui'
import { MarkdownLite } from '../../components/MarkdownLite'
import { t } from '../../strings/ptBR'
import type { IpcRequest } from '@shared/ipc-contract'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
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
      setMessages((prev) => [...prev, { role: 'assistant', content: res.answer }])
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
              <div key={i} className="flex justify-start">
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
