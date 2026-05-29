'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, Bot, MessageSquare, PanelRightClose, PanelRightOpen, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { localApi, type ChatMessage, type LocalModel } from '@/lib/local-api'

type ChatItem = ChatMessage & { id: string }

function parseStreamChunk(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '[DONE]') return ''

  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
  if (!payload) return ''

  try {
    const parsed = JSON.parse(payload) as {
      message?: { content?: string }
      choices?: Array<{ delta?: { content?: string } }>
      content?: string
    }
    return parsed.message?.content ?? parsed.choices?.[0]?.delta?.content ?? parsed.content ?? ''
  } catch {
    return payload.startsWith('data:') ? payload.slice(5).trim() : payload
  }
}

export default function SelfHostedChatPage() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState('0.7')
  const [maxTokens, setMaxTokens] = useState('2048')
  const [loadingModels, setLoadingModels] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await localApi.getModels()
        setModels(response.models)
        setSelectedModel((current) => current || response.models[0]?.id || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load local models')
      } finally {
        setLoadingModels(false)
      }
    })()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  const selected = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? null,
    [models, selectedModel],
  )

  const clearChat = () => {
    setMessages([])
    setError(null)
    toast.success('Chat cleared')
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = prompt.trim()
    if (!content || !selectedModel || sending) return

    const userMessage: ChatItem = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setPrompt('')
    setError(null)
    setSending(true)

    const assistantId = crypto.randomUUID()
    setMessages((current) => [...current, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const response = await localApi.chat({
        model: selectedModel,
        messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        system: systemPrompt.trim() || undefined,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : undefined,
        max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : undefined,
      })

      if (!response.body) throw new Error('Streaming response unavailable')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split(/\r?\n/)
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          const delta = parseStreamChunk(chunk)
          if (!delta) continue

          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content: `${message.content}${delta}` } : message,
            ),
          )
        }
      }

      const finalDelta = parseStreamChunk(buffer)
      if (finalDelta) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: `${message.content}${finalDelta}` } : message,
          ),
        )
      }

      toast.success('Response complete')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stream local response'
      setError(message)
      toast.error('Chat request failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-1px)] min-h-0 flex-col p-4 lg:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-dark bg-[#11120d] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">Local chat</p>
          <p className="text-xs text-[#8f937c]">Streaming conversations with Ollama or LM Studio.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-border-dark bg-[#1a1b16] px-3 py-2 text-sm text-white transition-colors hover:bg-[#25261e]"
          >
            {settingsOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            Settings
          </button>
          <button
            type="button"
            onClick={clearChat}
            className="inline-flex items-center gap-2 rounded-xl border border-border-dark bg-[#1a1b16] px-3 py-2 text-sm text-white transition-colors hover:bg-[#25261e]"
          >
            <Trash2 className="size-4" />
            Clear chat
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_320px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-border-dark bg-[#11120d]">
          <div className="border-b border-border-dark p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8f937c]">Model</span>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  disabled={loadingModels || models.length === 0}
                  className="rounded-xl border border-border-dark bg-[#1a1b16] px-3 py-3 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {models.length === 0 ? <option value="">No local models found</option> : null}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.provider}
                    </option>
                  ))}
                </select>
              </label>

              {selected ? (
                <div className="rounded-xl border border-border-dark bg-[#1a1b16] px-3 py-2 text-xs text-[#b1b4a2]">
                  <p className="font-medium text-white">{selected.name}</p>
                  <p className="mt-1">Context {selected.context_window.toLocaleString()} · {selected.provider}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-border-dark bg-[#1a1b16] p-8 text-center">
                <div className="max-w-lg">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <MessageSquare className="size-6" />
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-white">Start a local conversation</h2>
                  <p className="mt-2 text-sm leading-6 text-[#b1b4a2]">
                    Choose a model and send a message. Responses stream directly from your local provider.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[min(720px,92%)] rounded-3xl px-4 py-3 text-sm leading-6 ${
                        message.role === 'user'
                          ? 'bg-primary text-[#1d1e14]'
                          : 'border border-border-dark bg-[#1a1b16] text-white'
                      }`}
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
                        {message.role === 'user' ? 'You' : 'Assistant'}
                      </div>
                      <p className="whitespace-pre-wrap">{message.content || (sending && message.role === 'assistant' ? 'Streaming…' : '')}</p>
                    </div>
                  </div>
                ))}
                {sending ? (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-3xl border border-border-dark bg-[#1a1b16] px-4 py-3 text-sm text-[#b1b4a2]">
                      <div className="size-2.5 animate-pulse rounded-full bg-primary" />
                      Streaming response…
                    </div>
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="border-t border-border-dark p-4">
            <div className="rounded-[24px] border border-border-dark bg-[#1a1b16] p-3">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask your local model something…"
                rows={4}
                className="w-full resize-none bg-transparent text-sm text-white outline-none placeholder:text-[#8f937c]"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-[#8f937c]">Shift+Enter for a new line</p>
                <button
                  type="submit"
                  disabled={sending || loadingModels || !selectedModel || !prompt.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[#1d1e14] transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? <ArrowUpRight className="size-4 animate-pulse" /> : <Send className="size-4" />}
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </form>
        </section>

        {settingsOpen ? (
          <aside className="rounded-[28px] border border-border-dark bg-[#11120d] p-4 xl:block">
            <div className="flex items-center gap-2 border-b border-border-dark pb-3">
              <Bot className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-white">Prompt settings</h3>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#8f937c]">System prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={7}
                  placeholder="Optional instructions for the local model"
                  className="w-full rounded-2xl border border-border-dark bg-[#1a1b16] p-3 text-sm text-white outline-none placeholder:text-[#8f937c]"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#8f937c]">Temperature</span>
                  <input
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-2xl border border-border-dark bg-[#1a1b16] px-3 py-3 text-sm text-white outline-none"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-[#8f937c]">Max tokens</span>
                  <input
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                    inputMode="numeric"
                    className="w-full rounded-2xl border border-border-dark bg-[#1a1b16] px-3 py-3 text-sm text-white outline-none"
                  />
                </label>
              </div>

              {error ? (
                <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-border-dark bg-[#1a1b16] p-4 text-sm text-[#b1b4a2]">
                  Local chat uses streamed SSE output and supports both Ollama and LM Studio payload formats.
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
