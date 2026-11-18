"use client"

import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, TrashIcon } from './Icons'

type Conv = { id: string; title: string; updatedAt: string; count: number }
type Note = { id: string; text: string; ts: string }

/**
 * Second-brain management: saved conversations (open, start new, delete) and
 * memory notes (view, add, delete). Owner-only; every call carries the
 * passphrase in a header, never in a URL.
 */
export default function BrainPanel({
  ownerToken,
  conversationId,
  refreshKey,
  onSelect,
  onNew,
  onDeletedActive,
  onForgot,
}: {
  ownerToken: string
  conversationId: string
  /** Bumps after each answered turn so lists reflect what was just saved. */
  refreshKey: number
  onSelect: (id: string) => void
  onNew: () => void
  onDeletedActive: () => void
  /** A note was forgotten: reload the open conversation (its matching messages were removed). */
  onForgot: () => void
}) {
  const [convs, setConvs] = useState<Conv[] | null>(null)
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const headers = { 'x-owner-token': ownerToken }

  const load = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([
        fetch('/api/brain/conversations', { headers: { 'x-owner-token': ownerToken } }),
        fetch('/api/brain/notes', { headers: { 'x-owner-token': ownerToken } }),
      ])
      if (!c.ok || !n.ok) throw new Error('Could not load saved memory')
      setConvs((await c.json()).conversations ?? [])
      setNotes((await n.json()).notes ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Could not load saved memory')
    }
  }, [ownerToken])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const addNote = async () => {
    const text = draft.trim()
    if (!text) return
    const r = await fetch('/api/brain/notes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (r.ok) {
      setDraft('')
      void load()
    } else setError('Could not save the note')
  }

  const delNote = async (n: Note) => {
    if (!window.confirm('Forget this note permanently? The chat messages where you said it are removed too.\n\n' + n.text.slice(0, 160))) return
    const r = await fetch(`/api/brain/notes?id=${encodeURIComponent(n.id)}`, { method: 'DELETE', headers })
    if (r.ok) {
      setNotes((p) => (p ? p.filter((x) => x.id !== n.id) : p))
      onForgot()
      void load()
    } else setError('Could not delete the note')
  }

  const delConv = async (c: Conv) => {
    if (!window.confirm('Delete this conversation permanently? Notes and documents stay.\n\n' + c.title)) return
    const r = await fetch(`/api/brain/conversations?id=${encodeURIComponent(c.id)}`, { method: 'DELETE', headers })
    if (r.ok) {
      setConvs((p) => (p ? p.filter((x) => x.id !== c.id) : p))
      if (c.id === conversationId) onDeletedActive()
    } else setError('Could not delete the conversation')
  }

  return (
    <div className="space-y-5" data-testid="brain-panel">
      {error && <div className="text-[11px] text-red-300">{error}</div>}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Conversations</div>
          <button
            onClick={onNew}
            className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] text-gray-200 hover:border-primary/50"
          >
            <PlusIcon className="w-3 h-3" /> New conversation
          </button>
        </div>
        {convs === null ? (
          <div className="text-xs text-dim">Loading…</div>
        ) : convs.length === 0 ? (
          <div className="text-xs text-dim">No saved conversations yet.</div>
        ) : (
          <ul className="space-y-1">
            {convs.map((c) => (
              <li
                key={c.id}
                className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs ${
                  c.id === conversationId ? 'border-primary/50 bg-primary/10' : 'border-[var(--border)] bg-white/[0.02]'
                }`}
              >
                <button onClick={() => onSelect(c.id)} className="min-w-0 flex-1 text-left" title={c.title}>
                  <div className="truncate">{c.title}</div>
                  <div className="text-[10px] text-dim">
                    {new Date(c.updatedAt).toLocaleDateString()} · {Math.ceil(c.count / 2)} turn{c.count > 2 ? 's' : ''}
                  </div>
                </button>
                <button
                  onClick={() => delConv(c)}
                  className="p-1 text-dim hover:text-red-300"
                  aria-label={`Delete conversation ${c.title}`}
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
          Memory{notes ? ` · ${notes.length}` : ''}
        </div>
        <p className="text-[10px] leading-relaxed text-dim">
          Statements you make are saved here and shown to Claude with every answer. If two notes disagree, the newest wins. Delete a note to forget it.
        </p>
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addNote()}
            placeholder="Add a note…"
            dir="auto"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white/[0.03] px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
          />
          <button
            onClick={addNote}
            disabled={!draft.trim()}
            className="rounded-lg bg-primary px-2.5 text-xs font-medium text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {notes === null ? (
          <div className="text-xs text-dim">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-dim">Nothing saved yet.</div>
        ) : (
          <ul className="space-y-1">
            {[...notes].reverse().map((n) => (
              <li key={n.id} className="group flex items-start gap-1 rounded-lg border border-[var(--border)] bg-white/[0.02] px-2 py-1.5 text-xs">
                <div className="min-w-0 flex-1" dir="auto">
                  <div className="break-words">{n.text}</div>
                  <div className="text-[10px] text-dim">{new Date(n.ts).toLocaleDateString()}</div>
                </div>
                <button
                  onClick={() => delNote(n)}
                  className="p-1 text-dim hover:text-red-300"
                  aria-label="Forget this note"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
