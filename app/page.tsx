"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import FileUpload, { type UploadedDoc } from '@/components/FileUpload'
import DocList from '@/components/DocList'
import ChatInterface from '@/components/ChatInterface'
import MobileNav, { type MobileTab } from '@/components/MobileNav'
import type { DocItem } from '@/lib/docs'
import { PlusIcon } from '@/components/Icons'

export default function HomePage() {
  // Empty until mounted: the id comes from localStorage, so SSR and the
  // first client render must agree on "no session yet".
  const [sessionId, setSessionId] = useState<string>('')
  const [docs, setDocs] = useState<DocItem[]>([])
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  // BYOK: the visitor's Claude key lives ONLY in this React state. It is
  // never written to localStorage, cookies or the server beyond the single
  // request that uses it. Refreshing the tab forgets it by design.
  const [anthropicKey, setAnthropicKey] = useState('')
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  // Serializes embedding work; chat waits on it before querying.
  const embedQueue = useRef<Promise<void>>(Promise.resolve())

  // Restore the session after a refresh: the id is sticky, and the document
  // list is re-hydrated from the server (which restores it from the durable
  // store when one is configured). "New Session" is the only reset.
  const hydrationRan = useRef(false)
  useEffect(() => {
    // StrictMode double-invokes effects in dev; hydration must run exactly
    // once, and it must never overwrite documents uploaded in the meantime.
    if (hydrationRan.current) return
    hydrationRan.current = true
    let id = window.localStorage.getItem('rag:session')
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem('rag:session', id)
    }
    setSessionId(id)
    fetch(`/api/docs?session=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then(
        (data: {
          docs: Array<{ url: string; name?: string; filename: string; size?: number; type?: string }>
        }) => {
          if (!Array.isArray(data.docs)) return
          setDocs((prev) => {
            if (prev.length > 0) return prev // user already uploaded; server list is stale
            return data.docs.map((d) => ({
              id: crypto.randomUUID(),
              name: d.name ?? d.filename,
              url: d.url,
              size: d.size ?? 0,
              type: d.type ?? '',
              status: 'ready' as const,
            }))
          })
        }
      )
      .catch(() => {
        /* listing failed - the user can re-upload; chat still works */
      })
  }, [])

  const embedDocs = useCallback(
    (items: DocItem[]) => {
      const run = async () => {
        try {
          const res = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              docs: items.map((d) => ({ url: d.url, name: d.name, size: d.size, type: d.type })),
            }),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Failed to index documents' }))
            throw new Error(err.message || err.error || 'Failed to index documents')
          }
          const ids = new Set(items.map((i) => i.id))
          setDocs((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, status: 'ready' } : d)))
        } catch (e: any) {
          const ids = new Set(items.map((i) => i.id))
          setDocs((prev) =>
            prev.map((d) =>
              ids.has(d.id)
                ? { ...d, status: 'error', error: e?.message ?? 'Failed to index' }
                : d
            )
          )
        }
      }
      embedQueue.current = embedQueue.current.then(run)
      return embedQueue.current
    },
    [sessionId]
  )

  const handleUploaded = useCallback(
    (uploaded: UploadedDoc[]) => {
      const items: DocItem[] = uploaded.map((u) => ({
        ...u,
        id: crypto.randomUUID(),
        status: 'indexing',
      }))
      setDocs((prev) => [...prev, ...items])
      void embedDocs(items)
      setMobileTab('chat')
    },
    [embedDocs]
  )

  const handleRemoveDoc = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id)
      setDocs((prev) => prev.filter((d) => d.id !== id))
      // Real removal: drop the doc, its chunks and its stored bytes so a
      // refresh hydrates without it.
      if (doc) {
        void fetch(
          `/api/docs?session=${encodeURIComponent(sessionId)}&url=${encodeURIComponent(doc.url)}`,
          { method: 'DELETE' }
        ).catch(() => {})
      }
    },
    [docs, sessionId]
  )

  const handleRetryDoc = useCallback(
    (doc: DocItem) => {
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, status: 'indexing', error: undefined } : d))
      )
      void embedDocs([{ ...doc, status: 'indexing' }])
    },
    [embedDocs]
  )

  const handleNewSession = useCallback(() => {
    const id = crypto.randomUUID()
    window.localStorage.setItem('rag:session', id)
    setSessionId(id)
    setDocs([])
    embedQueue.current = Promise.resolve()
    setMobileTab('chat')
  }, [])

  // Explicit re-index after a serverless cold start wiped the index.
  // Costs API calls, which is why it only happens on user action.
  const handleReindex = useCallback(async (): Promise<boolean> => {
    const ready = docs.filter((d) => d.status !== 'error')
    if (ready.length === 0) return false
    setDocs((prev) => prev.map((d) => ({ ...d, status: 'indexing', error: undefined })))
    await embedDocs(ready.map((d) => ({ ...d, status: 'indexing' as const })))
    return true
  }, [docs, embedDocs])

  const awaitReady = useCallback(() => embedQueue.current, [])

  const readyCount = docs.filter((d) => d.status === 'ready').length

  if (!sessionId) {
    return <div className="h-dvh app-bg" aria-busy="true" />
  }

  return (
    <div className="h-dvh app-bg">
      <Sidebar
        uploadedDocs={docs}
        sessionId={sessionId}
        onNewSession={handleNewSession}
        onUploaded={handleUploaded}
        onRemoveDoc={handleRemoveDoc}
        onRetryDoc={handleRetryDoc}
      />

      <main className="h-dvh flex flex-col lg:ml-[320px] pb-[64px] lg:pb-0">
        <header className="shrink-0 sticky top-0 z-20 glass border-x-0 border-t-0 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              Smart Research Assistant
            </h1>
            {process.env.NEXT_PUBLIC_RAG_MOCK === '1' && !anthropicKey && (
              <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-300">
                Demo mode · simulated answers
              </span>
            )}
            {anthropicKey && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                Claude connected · answers billed to your key
              </span>
            )}
            <button
              onClick={() => setKeyPanelOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium text-dim hover:border-primary/50 hover:text-white transition-colors"
            >
              {anthropicKey ? 'Key settings' : 'Use your Claude key'}
            </button>
            <span
              className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
                readyCount > 0
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border-[var(--border)] bg-white/[0.03] text-dim'
              }`}
            >
              {readyCount > 0
                ? `Research mode · ${readyCount} document${readyCount === 1 ? '' : 's'}`
                : 'Chat mode'}
            </span>
          </div>
          <button
            onClick={handleNewSession}
            className="lg:hidden shrink-0 flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-gray-200 hover:border-primary/50 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New
          </button>
        </header>

        {/* Chat panel */}
        <div className={`flex-1 overflow-hidden ${mobileTab === 'chat' ? '' : 'hidden lg:block'}`}>
          <ChatInterface
            key={sessionId}
            sessionId={sessionId}
            docs={docs}
            awaitReady={awaitReady}
            onReindex={handleReindex}
            anthropicKey={anthropicKey || undefined}
          />
        </div>

        {/* Mobile files panel */}
        <div
          className={`flex-1 overflow-y-auto lg:hidden ${mobileTab === 'files' ? 'rise-in' : 'hidden'}`}
        >
          <div className="max-w-xl mx-auto p-4 space-y-4">
            <FileUpload sessionId={sessionId} onComplete={handleUploaded} />
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
              Documents
            </div>
            <DocList docs={docs} onRemove={handleRemoveDoc} onRetry={handleRetryDoc} />
          </div>
        </div>
      </main>

      <MobileNav tab={mobileTab} onChange={setMobileTab} docCount={docs.length} />

      {keyPanelOpen && (
        <ClaudeKeyPanel
          currentKey={anthropicKey}
          onSave={(k) => {
            setAnthropicKey(k)
            setKeyPanelOpen(false)
          }}
          onClear={() => {
            setAnthropicKey('')
            setKeyPanelOpen(false)
          }}
          onClose={() => setKeyPanelOpen(false)}
        />
      )}
    </div>
  )
}

function ClaudeKeyPanel({
  currentKey,
  onSave,
  onClear,
  onClose,
}: {
  currentKey: string
  onSave: (key: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const valid = value.startsWith('sk-ant-') && value.length >= 20
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-key-title"
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface,#14141c)] p-5 space-y-4 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="claude-key-title" className="text-sm font-semibold">
            Use your own Claude key
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-dim hover:text-white text-lg leading-none"
          >
            &times;
          </button>
        </div>
        <p className="text-xs text-dim leading-relaxed">
          Enter your Anthropic API key to get real Claude answers instead of the demo.
          Anthropic bills that usage to your account at their current rates. Document
          retrieval in this demo is keyword-based, not semantic embeddings.
        </p>
        <p className="text-xs text-dim leading-relaxed">
          Your key stays in this browser tab only: it is never saved, never stored, and is
          sent only with the question you ask. Closing or refreshing the tab forgets it.
        </p>
        <label htmlFor="claude-key-input" className="sr-only">
          Anthropic API key
        </label>
        <input
          id="claude-key-input"
          type="password"
          autoComplete="off"
          autoFocus
          placeholder="sk-ant-..."
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          className="w-full rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        <div className="flex items-center justify-end gap-2">
          {currentKey && (
            <button
              onClick={onClear}
              className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10"
            >
              Disconnect
            </button>
          )}
          <button
            disabled={!valid}
            onClick={() => onSave(value)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Connect for this tab
          </button>
        </div>
      </div>
    </div>
  )
}
