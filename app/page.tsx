"use client"

import { useCallback, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import FileUpload, { type UploadedDoc } from '@/components/FileUpload'
import DocList from '@/components/DocList'
import ChatInterface from '@/components/ChatInterface'
import MobileNav, { type MobileTab } from '@/components/MobileNav'
import type { DocItem } from '@/lib/docs'
import { PlusIcon } from '@/components/Icons'

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [docs, setDocs] = useState<DocItem[]>([])
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  // Serializes embedding work; chat waits on it before querying.
  const embedQueue = useRef<Promise<void>>(Promise.resolve())

  const embedDocs = useCallback(
    (items: DocItem[]) => {
      const run = async () => {
        try {
          const res = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              docs: items.map((d) => ({ url: d.url, name: d.name })),
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

  const handleRemoveDoc = useCallback((id: string) => {
    // Removing a doc only affects the client list; already-embedded chunks
    // stay in this session's store until the session ends (no re-embedding).
    setDocs((prev) => prev.filter((d) => d.id !== id))
  }, [])

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
    setSessionId(crypto.randomUUID())
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

  return (
    <div className="h-dvh app-bg">
      <Sidebar
        uploadedDocs={docs}
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
          />
        </div>

        {/* Mobile files panel */}
        <div
          className={`flex-1 overflow-y-auto lg:hidden ${mobileTab === 'files' ? '' : 'hidden'}`}
        >
          <div className="max-w-xl mx-auto p-4 space-y-4">
            <FileUpload onComplete={handleUploaded} />
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
              Documents
            </div>
            <DocList docs={docs} onRemove={handleRemoveDoc} onRetry={handleRetryDoc} />
          </div>
        </div>
      </main>

      <MobileNav tab={mobileTab} onChange={setMobileTab} docCount={docs.length} />
    </div>
  )
}
