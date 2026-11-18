"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import FileUpload, { type UploadedDoc } from '@/components/FileUpload'
import DocList from '@/components/DocList'
import ChatInterface from '@/components/ChatInterface'
import MobileNav, { type MobileTab } from '@/components/MobileNav'
import type { DocItem } from '@/lib/docs'
import { PlusIcon } from '@/components/Icons'
import { BRAIN_SESSION_ID } from '@/lib/brainId'
import BrainPanel from '@/components/BrainPanel'

export default function HomePage() {
  // Empty until mounted: the id comes from localStorage, so SSR and the
  // first client render must agree on "no session yet".
  const [localSession, setLocalSession] = useState<string>('')
  const [docs, setDocs] = useState<DocItem[]>([])
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')
  // BYOK: the visitor's Claude key lives ONLY in this React state. It is
  // never written to localStorage, cookies or the server beyond the single
  // request that uses it. Refreshing the tab forgets it by design.
  const [anthropicKey, setAnthropicKey] = useState('')
  // Owner mode: the owner's passphrase, also memory-only. When set, the
  // server uses its own stored key instead of a visitor-entered one.
  const [ownerToken, setOwnerToken] = useState('')
  const [keyPanelOpen, setKeyPanelOpen] = useState(false)
  // Owner mode switches to the one permanent, owner-only second brain. Visitors
  // never see it: the server rejects its id without the owner passphrase.
  const brain = Boolean(ownerToken)
  const sessionId = brain ? BRAIN_SESSION_ID : localSession
  // Second brain conversations: knowledge is shared, chats are separate. The
  // active conversation id lives in memory only (nothing brain-related is
  // written to localStorage). null = still resolving on connect.
  const [brainConv, setBrainConv] = useState<string | null>(null)
  const [brainRefresh, setBrainRefresh] = useState(0)
  const [brainReload, setBrainReload] = useState(0)
  const authHeaders = useMemo(() => {
    const h: Record<string, string> = {}
    if (ownerToken) h['x-owner-token'] = ownerToken
    return h
  }, [ownerToken])
  // Serializes embedding work; chat waits on it before querying.
  const embedQueue = useRef<Promise<void>>(Promise.resolve())

  // Restore the session after a refresh: the id is sticky, and the document
  // list is re-hydrated from the server (which restores it from the durable
  // store when one is configured). "New Session" is the only reset.
  const hydrationRan = useRef(false)
  useEffect(() => {
    // StrictMode double-invokes effects in dev; the id must be created once.
    if (hydrationRan.current) return
    hydrationRan.current = true
    let id = window.localStorage.getItem('rag:session')
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem('rag:session', id)
    }
    setLocalSession(id)
  }, [])

  // On connect, resume the most recent saved conversation (or start a new one).
  useEffect(() => {
    if (!ownerToken) {
      setBrainConv(null)
      return
    }
    let cancelled = false
    fetch('/api/brain/conversations', { headers: { 'x-owner-token': ownerToken } })
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d: { conversations?: Array<{ id: string }> }) => {
        if (!cancelled) setBrainConv(d.conversations?.[0]?.id ?? crypto.randomUUID())
      })
      .catch(() => {
        if (!cancelled) setBrainConv(crypto.randomUUID())
      })
    return () => {
      cancelled = true
    }
  }, [ownerToken])

  // Open a stored original: header-authorized fetch -> blob, so the passphrase
  // never travels in a URL.
  const handleOpenDoc = useCallback(
    async (doc: DocItem) => {
      const win = window.open('', '_blank')
      try {
        const res = await fetch(doc.url, { headers: authHeaders })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        const href = URL.createObjectURL(blob)
        if (win) win.location.href = href
        else window.location.href = href
        setTimeout(() => URL.revokeObjectURL(href), 5 * 60 * 1000)
      } catch {
        win?.close()
        window.alert('Could not open this file.')
      }
    },
    [authHeaders]
  )

  // Load the active space's document list: the visitor's own session, or the
  // owner's second brain once the passphrase is connected. Documents still
  // uploading or failed in this tab are kept on top of the server list.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    fetch(`/api/docs?session=${encodeURIComponent(sessionId)}`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then(
        (data: {
          docs: Array<{ url: string; name?: string; filename: string; size?: number; type?: string }>
        }) => {
          if (cancelled || !Array.isArray(data.docs)) return
          setDocs((prev) => {
            const pending = prev.filter((d) => d.status !== 'ready')
            const known = new Set(data.docs.map((d) => d.url))
            return [
              ...data.docs.map((d) => ({
                id: crypto.randomUUID(),
                name: d.name ?? d.filename,
                url: d.url,
                size: d.size ?? 0,
                type: d.type ?? '',
                status: 'ready' as const,
              })),
              ...pending.filter((d) => !known.has(d.url)),
            ]
          })
        }
      )
      .catch(() => {
        /* listing failed - the user can re-upload; chat still works */
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, authHeaders])

  const embedDocs = useCallback(
    (items: DocItem[]) => {
      const run = async () => {
        try {
          const res = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
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
    [sessionId, authHeaders]
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
          { method: 'DELETE', headers: authHeaders }
        ).catch(() => {})
      }
    },
    [docs, sessionId, authHeaders]
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
    setLocalSession(id)
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

  if (!sessionId || (brain && brainConv === null)) {
    return <div className="h-dvh app-bg" aria-busy="true" />
  }

  const brainPanel =
    brain && brainConv ? (
      <BrainPanel
        ownerToken={ownerToken}
        conversationId={brainConv}
        refreshKey={brainRefresh}
        onSelect={(id) => {
          setBrainConv(id)
          setMobileTab('chat')
        }}
        onNew={() => {
          setBrainConv(crypto.randomUUID())
          setMobileTab('chat')
        }}
        onDeletedActive={() => setBrainConv(crypto.randomUUID())}
        onForgot={() => setBrainReload((n) => n + 1)}
      />
    ) : null

  return (
    <div className="h-dvh app-bg">
      <Sidebar
        uploadedDocs={docs}
        sessionId={sessionId}
        onNewSession={handleNewSession}
        onUploaded={handleUploaded}
        onRemoveDoc={handleRemoveDoc}
        onRetryDoc={handleRetryDoc}
        ownerToken={ownerToken || undefined}
        brain={brain}
        onOpenDoc={brain ? handleOpenDoc : undefined}
        brainPanel={brainPanel}
      />

      <main className="h-dvh flex flex-col lg:ml-[320px] pb-[64px] lg:pb-0">
        <header className="shrink-0 sticky top-0 z-20 glass border-x-0 border-t-0 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
              Smart Research Assistant
            </h1>
            {process.env.NEXT_PUBLIC_RAG_MOCK === '1' && !anthropicKey && !ownerToken && (
              <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-300">
                Demo mode · simulated answers
              </span>
            )}
            {anthropicKey && (
              <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                Claude connected · answers billed to your key
              </span>
            )}
            {ownerToken && (
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                Second brain · owner mode
              </span>
            )}
            <button
              onClick={() => setKeyPanelOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium text-dim hover:border-primary/50 hover:text-white transition-colors"
            >
              {anthropicKey || ownerToken ? 'Key settings' : 'Use your Claude key'}
            </button>
            {ownerToken && (
              <a
                href="/lab"
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--border)] bg-white/[0.03] px-2.5 py-0.5 text-[10px] font-medium text-dim hover:border-primary/50 hover:text-white transition-colors"
              >
                Lab
              </a>
            )}
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
            onClick={brain ? () => setBrainConv(crypto.randomUUID()) : handleNewSession}
            className="lg:hidden shrink-0 flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-gray-200 hover:border-primary/50 transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New
          </button>
        </header>

        {/* Chat panel */}
        <div className={`flex-1 overflow-hidden ${mobileTab === 'chat' ? '' : 'hidden lg:block'}`}>
          <ChatInterface
            key={`${sessionId}:${brainConv ?? ''}:${brainReload}`}
            conversationId={brain ? brainConv ?? undefined : undefined}
            onTurnDone={() => setBrainRefresh((n) => n + 1)}
            sessionId={sessionId}
            docs={docs}
            awaitReady={awaitReady}
            onReindex={handleReindex}
            anthropicKey={anthropicKey || undefined}
            ownerToken={ownerToken || undefined}
            brain={brain}
          />
        </div>

        {/* Mobile files panel */}
        <div
          className={`flex-1 overflow-y-auto lg:hidden ${mobileTab === 'files' ? 'rise-in' : 'hidden'}`}
        >
          <div className="max-w-xl mx-auto p-4 space-y-4">
            <FileUpload sessionId={sessionId} onComplete={handleUploaded} ownerToken={ownerToken || undefined} />
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
              Documents
            </div>
            <DocList docs={docs} onRemove={handleRemoveDoc} onRetry={handleRetryDoc} onOpen={brain ? handleOpenDoc : undefined} />
            {brainPanel}
          </div>
        </div>
      </main>

      <MobileNav tab={mobileTab} onChange={setMobileTab} docCount={docs.length} />

      {keyPanelOpen && (
        <ClaudeKeyPanel
          currentKey={anthropicKey}
          currentOwnerToken={ownerToken}
          onSave={(k, t) => {
            setAnthropicKey(k)
            setOwnerToken(t)
            setKeyPanelOpen(false)
          }}
          onClear={() => {
            setAnthropicKey('')
            setOwnerToken('')
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
  currentOwnerToken,
  onSave,
  onClear,
  onClose,
}: {
  currentKey: string
  currentOwnerToken: string
  onSave: (key: string, ownerToken: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [ownerValue, setOwnerValue] = useState('')
  const keyValid = value.startsWith('sk-ant-') && value.length >= 20
  const ownerValid = ownerValue.length >= 8
  const valid = ownerValue.length > 0 ? ownerValid : keyValid
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
        <label
          htmlFor="claude-key-input"
          className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-dim"
        >
          Your Anthropic API key
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
        <div className="border-t border-[var(--border)] pt-3 space-y-2">
          <p className="text-xs text-dim leading-relaxed">
            Site owner? Enter the owner passphrase to answer with the site&rsquo;s own key.
            The passphrase also stays in this tab only.
          </p>
          <label
            htmlFor="owner-token-input"
            className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-dim"
          >
            Owner passphrase (site owner only)
          </label>
          <input
            id="owner-token-input"
            type="password"
            autoComplete="off"
            placeholder="Owner passphrase"
            value={ownerValue}
            onChange={(e) => setOwnerValue(e.target.value.trim())}
            className="w-full rounded-lg border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          {(currentKey || currentOwnerToken) && (
            <button
              onClick={onClear}
              className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10"
            >
              Disconnect
            </button>
          )}
          <button
            disabled={!valid}
            onClick={() => onSave(ownerValue.length > 0 ? '' : value, ownerValue)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Connect for this tab
          </button>
        </div>
      </div>
    </div>
  )
}
