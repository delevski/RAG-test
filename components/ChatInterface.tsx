"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ChatMessage, Citation, DocItem } from '@/lib/docs'
import { SOURCES_DELIMITER } from '@/lib/docs'
import Markdown from './Markdown'
import {
  SendIcon,
  StopIcon,
  RetryIcon,
  CopyIcon,
  CheckIcon,
  FileIcon,
  SparklesIcon,
  AlertIcon,
  LogoMark,
} from './Icons'

const GREETING_NO_DOCS =
  'Hello! I can help you with questions or chat. Upload documents to enable research mode, or just ask me anything!'
const GREETING_WITH_DOCS =
  'What exactly would you like to research or learn from these documents?'

const SUGGESTIONS_NO_DOCS = [
  'Explain retrieval-augmented generation in simple terms',
  'Help me outline a research report',
  'What can you do?',
]
const SUGGESTIONS_WITH_DOCS = [
  'Summarize these documents',
  'What are the key takeaways?',
  'List the main facts with sources',
]

function storageKey(sessionId: string) {
  return `rag:messages:${sessionId}`
}

function Citations({ sources }: { sources: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="mt-2.5 pt-2.5 border-t border-[var(--border)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dim mb-1.5">
        Sources
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <button
            key={`${s.name}-${i}`}
            onClick={() => setOpen(open === i ? null : i)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              open === i
                ? 'border-primary/60 bg-primary/15 text-white'
                : 'border-[var(--border)] bg-white/[0.03] text-dim hover:text-white hover:border-primary/40'
            }`}
          >
            <FileIcon className="w-3 h-3" />
            <span className="max-w-[180px] truncate">{s.name}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {open !== null && sources[open] && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <blockquote className="mt-2 text-[11px] leading-relaxed text-dim border-l-2 border-primary/60 pl-3">
              {sources[open].snippet}…
            </blockquote>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="p-1.5 rounded-lg text-dim hover:text-white hover:bg-white/10 transition-colors"
      aria-label="Copy message"
      title="Copy"
    >
      {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <CopyIcon className="w-3.5 h-3.5" />}
    </button>
  )
}

export default function ChatInterface({
  sessionId,
  docs,
  awaitReady,
  onReindex,
}: {
  sessionId: string
  docs: DocItem[]
  awaitReady: () => Promise<void>
  onReindex: () => Promise<boolean>
}) {
  const hasDocs = useMemo(() => docs.length > 0, [docs])
  const hasReadyDocs = useMemo(() => docs.some((d) => d.status === 'ready'), [docs])
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greeting', role: 'system', content: GREETING_NO_DOCS },
  ])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [indexMissing, setIndexMissing] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastUserQuery = useRef<string | null>(null)

  // Restore history for this session (client-side convenience only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(sessionId))
      if (raw) {
        const saved = JSON.parse(raw) as ChatMessage[]
        if (Array.isArray(saved) && saved.length > 0) {
          setMessages(saved)
        }
      }
    } catch {
      /* corrupted storage - start fresh */
    }
    setHydrated(true)
  }, [sessionId])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(storageKey(sessionId), JSON.stringify(messages.slice(-100)))
    } catch {
      /* storage full - ignore */
    }
  }, [messages, sessionId, hydrated])

  // Keep the greeting in sync with whether documents exist.
  useEffect(() => {
    setMessages((prev) => {
      const first = prev[0]
      if (first?.role === 'system') {
        const next = hasDocs ? GREETING_WITH_DOCS : GREETING_NO_DOCS
        if (first.content !== next) return [{ ...first, content: next }, ...prev.slice(1)]
      }
      return prev
    })
  }, [hasDocs])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  const sendMessage = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim()
      if (!text || isStreaming) return // double-send guard
      lastUserQuery.current = text
      setInput('')
      setIndexMissing(false)

      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text }
      setMessages((m) => [...m, userMsg])
      setIsStreaming(true)

      try {
        // If an upload is still embedding, wait for it so the answer can use it.
        await awaitReady()

        const controller = new AbortController()
        abortRef.current = controller

        const res = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            query: text,
            expectContext: hasReadyDocs,
          }),
          signal: controller.signal,
        })

        if (res.status === 409) {
          setIndexMissing(true)
          setMessages((m) => m.filter((x) => x.id !== userMsg.id))
          setInput(text)
          return
        }
        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(errorText || `Server error: ${res.status}`)
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response stream available')

        const decoder = new TextDecoder()
        let rawText = ''
        const assistantId = crypto.randomUUID()
        setMessages((m) => [...m, { id: assistantId, role: 'assistant', content: '' }])

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          rawText += decoder.decode(value, { stream: true })
          const cut = rawText.indexOf(SOURCES_DELIMITER)
          const visible = cut === -1 ? rawText : rawText.slice(0, cut)
          setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: visible } : x)))
        }

        // The sources trailer is written as one chunk after the answer
        // stream ends, and parsed only now — token boundaries cannot split it.
        let sources: Citation[] | undefined
        const cut = rawText.indexOf(SOURCES_DELIMITER)
        if (cut !== -1) {
          try {
            sources = JSON.parse(rawText.slice(cut + SOURCES_DELIMITER.length))
          } catch {
            sources = undefined
          }
        }
        const finalContent = cut === -1 ? rawText : rawText.slice(0, cut)
        setMessages((m) =>
          m.map((x) => (x.id === assistantId ? { ...x, content: finalContent, sources } : x))
        )
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setMessages((m) =>
            m.map((x) =>
              x.role === 'assistant' && x.content === '' && !x.sources
                ? { ...x, content: '_Stopped._' }
                : x
            )
          )
        } else {
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: err?.message ?? 'Something went wrong',
              failed: true,
            },
          ])
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
      }
    },
    [input, isStreaming, sessionId, hasReadyDocs, awaitReady]
  )

  const handleReindex = useCallback(async () => {
    setReindexing(true)
    const ok = await onReindex()
    setReindexing(false)
    if (ok) {
      setIndexMissing(false)
      if (lastUserQuery.current) void sendMessage(lastUserQuery.current)
    }
  }, [onReindex, sendMessage])

  const showEmptyState = messages.length <= 1
  const suggestions = hasDocs ? SUGGESTIONS_WITH_DOCS : SUGGESTIONS_NO_DOCS

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Index-missing notice: re-indexing costs API calls, so it's explicit */}
      <AnimatePresence>
        {indexMissing && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mx-4 mt-3 glass rounded-xl px-4 py-3 flex flex-wrap items-center gap-3"
            role="alert"
          >
            <AlertIcon className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-gray-200 flex-1 min-w-[200px]">
              This server instance lost the document index (serverless cold start). Re-index your
              documents to ground answers in them — this re-runs the embedding step.
            </p>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className="text-xs font-medium rounded-lg gradient-bg text-white px-3 py-1.5 hover:brightness-110 disabled:opacity-50 transition"
            >
              {reindexing ? 'Re-indexing…' : 'Re-index documents'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          {showEmptyState ? (
            <div className="rise-in flex flex-col items-center text-center pt-10 sm:pt-16">
              <LogoMark className="w-16 h-16" />
              <h2 className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight">
                Research, <span className="gradient-text">grounded in your sources</span>
              </h2>
              <p className="mt-2.5 text-sm text-dim max-w-md">
                Upload PDF, DOCX or TXT files and ask questions — answers are retrieved from your
                documents with citations, or just chat freely.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void sendMessage(s)}
                    className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3.5 py-1.5 text-xs text-gray-200 hover:border-primary/50 hover:bg-primary/10 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="mt-10 w-full text-start">
                <div className="glass rounded-2xl p-4 text-sm text-gray-200 rise-in">
                  {messages[0].content}
                </div>
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role !== 'user' && (
                  <div className="shrink-0 w-7 h-7 rounded-lg gradient-bg flex items-center justify-center text-white mt-0.5">
                    <SparklesIcon className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                    m.role === 'user'
                      ? 'bg-primary/15 border border-primary/25 text-gray-100'
                      : m.failed
                        ? 'glass border-red-500/30'
                        : 'glass'
                  }`}
                >
                  {m.role === 'assistant' || m.role === 'system' ? (
                    <>
                      {m.content ? (
                        <Markdown>{m.content}</Markdown>
                      ) : (
                        <span className="flex gap-1 py-1" aria-label="Thinking">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="typing-dot w-1.5 h-1.5 rounded-full bg-dim"
                              style={{ animationDelay: `${i * 0.18}s` }}
                            />
                          ))}
                        </span>
                      )}
                      {m.sources && m.sources.length > 0 && <Citations sources={m.sources} />}
                      {m.failed ? (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-red-300 flex-1">{m.content}</span>
                          <button
                            onClick={() => {
                              setMessages((prev) => prev.filter((x) => x.id !== m.id))
                              if (lastUserQuery.current) void sendMessage(lastUserQuery.current)
                            }}
                            className="flex items-center gap-1.5 text-xs font-medium rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-gray-200 hover:border-primary/50 hover:bg-primary/10 transition-colors"
                          >
                            <RetryIcon className="w-3.5 h-3.5" /> Retry
                          </button>
                        </div>
                      ) : (
                        m.content && (
                          <div className="mt-1.5 -mb-0.5 flex justify-end">
                            <CopyButton text={m.content} />
                          </div>
                        )
                      )}
                    </>
                  ) : (
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  )}
                </div>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-xl p-3 sm:p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage()
          }}
          className="max-w-3xl mx-auto"
        >
          <div className="gradient-border rounded-2xl flex items-center gap-2 pl-4 pr-2 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                hasReadyDocs ? 'Ask a question about your documents…' : 'Ask me anything or chat…'
              }
              aria-label="Message"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-dim/70 min-w-0"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="shrink-0 flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-gray-200 hover:border-red-400/50 hover:text-red-300 transition-colors"
                aria-label="Stop generating"
              >
                <StopIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="shrink-0 flex items-center gap-1.5 rounded-xl gradient-bg text-white px-3.5 py-2 text-sm font-medium shadow-glow hover:brightness-110 active:scale-[0.97] disabled:opacity-40 disabled:shadow-none transition"
              >
                <SendIcon className="w-3.5 h-3.5" />
                Send
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-dim/70">
            Answers with sources are retrieved from your documents; everything else is general
            chat.
          </p>
        </form>
      </div>
    </div>
  )
}
