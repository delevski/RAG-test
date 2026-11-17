"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import ThinkingIndicator, { type ThinkingPhase } from './ThinkingIndicator'
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
          <motion.button
            key={`${s.name}-${i}`}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.07 * i, type: 'spring', stiffness: 380, damping: 24 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(open === i ? null : i)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              open === i
                ? 'border-primary/60 bg-primary/15 text-white'
                : 'border-[var(--border)] bg-white/[0.03] text-dim hover:text-white hover:border-primary/40'
            }`}
          >
            <FileIcon className="w-3 h-3" />
            <span className="max-w-[180px] truncate">{s.name}</span>
          </motion.button>
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
  anthropicKey,
  ownerToken,
}: {
  sessionId: string
  docs: DocItem[]
  awaitReady: () => Promise<void>
  onReindex: () => Promise<boolean>
  /** Visitor-supplied Claude key, memory-only, sent per request when set. */
  anthropicKey?: string
  /** Owner passphrase unlocking the server-side key, memory-only. */
  ownerToken?: string
}) {
  const hasDocs = useMemo(() => docs.length > 0, [docs])
  const hasReadyDocs = useMemo(() => docs.some((d) => d.status === 'ready'), [docs])
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'greeting', role: 'system', content: GREETING_NO_DOCS },
  ])
  const [hydrated, setHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  // What the user is actually waiting on; never a fabricated stage or timer.
  const [phase, setPhase] = useState<ThinkingPhase | null>(null)
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
      setPhase(
        docs.some((d) => d.status === 'indexing')
          ? 'awaiting-index'
          : hasReadyDocs
            ? 'connecting-docs'
            : 'connecting-chat'
      )

      try {
        // If an upload is still embedding, wait for it so the answer can use it.
        await awaitReady()
        setPhase(hasReadyDocs ? 'connecting-docs' : 'connecting-chat')

        const controller = new AbortController()
        abortRef.current = controller

        const res = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            query: text,
            expectContext: hasReadyDocs,
            ...(anthropicKey ? { anthropicKey } : {}),
            ...(ownerToken ? { ownerToken } : {}),
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
        setPhase(null)
      }
    },
    [input, isStreaming, sessionId, hasReadyDocs, awaitReady, docs, anthropicKey, ownerToken]
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
    <MotionConfig reducedMotion="user">
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
            <div className="flex flex-col items-center text-center pt-10 sm:pt-16">
              <motion.div
                className="relative"
                initial={{ opacity: 0, scale: 0.6, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 16 }}
              >
                <div
                  className="logo-halo absolute -inset-4 rounded-full blur-2xl"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(99,102,241,0.4), rgba(34,211,238,0.15) 60%, transparent 75%)',
                  }}
                  aria-hidden
                />
                <div className="float-y relative">
                  <LogoMark className="w-16 h-16 drop-shadow-[0_8px_24px_rgba(99,102,241,0.45)]" />
                </div>
              </motion.div>
              <motion.h2
                className="mt-5 text-2xl sm:text-3xl font-semibold tracking-tight"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, type: 'spring', stiffness: 260, damping: 22 }}
              >
                Research, <span className="gradient-text">grounded in your sources</span>
              </motion.h2>
              <motion.p
                className="mt-2.5 text-sm text-dim max-w-md"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 260, damping: 22 }}
              >
                Upload PDF, DOCX or TXT files and ask questions — answers are retrieved from your
                documents with citations, or just chat freely.
              </motion.p>
              <div className="mt-7 flex flex-wrap justify-center gap-2">
                {suggestions.map((s, si) => (
                  <motion.button
                    key={s}
                    initial={{ opacity: 0, y: 10, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.28 + 0.08 * si, type: 'spring', stiffness: 320, damping: 22 }}
                    whileHover={{ scale: 1.05, y: -2 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => void sendMessage(s)}
                    className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3.5 py-1.5 text-xs text-gray-200 hover:border-primary/50 hover:bg-primary/10 transition-colors"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
              <motion.div
                className="mt-10 w-full text-start"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, type: 'spring', stiffness: 240, damping: 24 }}
              >
                <div className="glass rounded-2xl p-4 text-sm text-gray-200">
                  {messages[0].content}
                </div>
              </motion.div>
            </div>
          ) : (
            <>

              {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 340, damping: 27 }}
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
                        <>
                          <Markdown>{m.content}</Markdown>
                          {isStreaming && m.role === 'assistant' && !m.sources && (
                            <span className="stream-caret" aria-hidden />
                          )}
                        </>
                      ) : (
                        <ThinkingIndicator phase={phase ?? (hasReadyDocs ? 'connecting-docs' : 'connecting-chat')} />
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
              ))}
              {phase !== null &&
                !messages.some((x) => x.role === 'assistant' && x.content === '' && !x.sources) && (
                <motion.div
                  key="waiting-row"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex gap-3 justify-start"
                >
                  <div className="shrink-0 w-7 h-7 rounded-lg gradient-bg flex items-center justify-center text-white mt-0.5">
                    <SparklesIcon className="w-3.5 h-3.5" />
                  </div>
                  <div className="glass rounded-2xl px-4 py-3">
                    <ThinkingIndicator phase={phase} />
                  </div>
                </motion.div>
              )}
            </>
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
          <div className="gradient-border composer-glow rounded-2xl flex items-center gap-2 pl-4 pr-2 py-2 transition-shadow">
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
    </MotionConfig>
  )
}
