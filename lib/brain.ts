import type { NextApiRequest } from 'next'
import { ownerModeConfigured, ownerTokenMatches } from '@/lib/ai/ownerKey'

/**
 * Second brain: ONE reserved, owner-only knowledge space.
 *
 * Public visitors get random per-browser session ids and can only ever reach
 * those. The reserved id below is never handed to a visitor: every route that
 * touches it must pass assertBrainAccess(), which requires the owner
 * passphrase (header `x-owner-token`) to match the server's RAG_OWNER_TOKEN.
 * No token, a wrong token or an unconfigured deployment all mean 403, so the
 * public demo can never read, write or list the owner's knowledge.
 */
import { BRAIN_SESSION_ID } from '@/lib/brainId'
export { BRAIN_SESSION_ID }
export const BRAIN_FORBIDDEN = 'BRAIN_FORBIDDEN'

// A single owner space is much larger than a throwaway visitor session.
export const BRAIN_MAX_DOCS = 200
export const BRAIN_MAX_CHUNKS = 5000

export function isBrainSession(sessionId: unknown): boolean {
  // Case-insensitive on purpose: no spelling of the reserved id is ever a visitor session.
  return typeof sessionId === 'string' && sessionId.toLowerCase() === BRAIN_SESSION_ID
}

export function brainTokenFromRequest(req: Pick<NextApiRequest, 'headers' | 'body'>): unknown {
  const h = req.headers?.['x-owner-token']
  if (typeof h === 'string' && h.length > 0) return h
  const b = (req.body as any)?.ownerToken
  return typeof b === 'string' ? b : undefined
}

/** Throws BRAIN_FORBIDDEN unless `sessionId` is a normal session or the owner proved ownership. */
export function assertBrainAccess(
  req: Pick<NextApiRequest, 'headers' | 'body'>,
  sessionId: unknown,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!isBrainSession(sessionId)) return
  if (!ownerModeConfigured(env) || !ownerTokenMatches(brainTokenFromRequest(req), env)) {
    throw new Error(BRAIN_FORBIDDEN)
  }
}

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }
export const MAX_HISTORY_TURNS = 12
export const MAX_HISTORY_CHARS = 2000

/** Client-supplied recent turns, validated and bounded. Anything odd is dropped. */
export function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryTurn[] = []
  for (const t of raw) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant')) continue
    if (typeof t.content !== 'string' || t.content.trim().length === 0) continue
    out.push({ role: t.role, content: t.content.slice(0, MAX_HISTORY_CHARS) })
  }
  return out.slice(-MAX_HISTORY_TURNS)
}

// ---------------------------------------------------------------------------
// Memory notes
// ---------------------------------------------------------------------------
export type Note = { id: string; text: string; ts: string }
export const MAX_NOTE_CHARS = 1000
export const MAX_NOTES = 2000
/** Notes always included verbatim (newest first) up to this many characters. */
export const NOTES_CHAR_BUDGET = 12000
/** Extra budget for older notes that lexically match the question. */
export const OLD_NOTES_CHAR_BUDGET = 4000

const CONV_ID = /^[a-zA-Z0-9-]{1,64}$/
export function sanitizeConversationId(raw: unknown): string {
  return typeof raw === 'string' && CONV_ID.test(raw) ? raw : 'default'
}

/**
 * A user message becomes a memory note when it is a statement, not a
 * question. Questions are kept in the chat history only.
 */
export function noteFromUserMessage(text: string): string | null {
  const t = text.trim()
  if (t.length < 3) return null
  if (/[?\u061f]\s*$/.test(t)) return null
  return t.slice(0, MAX_NOTE_CHARS)
}

const HE_PREFIX = /^[\u05d4\u05d5\u05d1\u05dc\u05de\u05e9\u05db]{1,2}(?=[\u0590-\u05ff]{3,})/
function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9\u0590-\u05ff]+/)) {
    if (raw.length < 2) continue
    out.add(raw)
    const stripped = raw.replace(HE_PREFIX, '')
    if (stripped !== raw && stripped.length >= 2) out.add(stripped)
  }
  return out
}

/**
 * Which saved notes the model sees for this question. Recent notes always go
 * in verbatim (so a paraphrased question is matched by Claude itself, no extra
 * provider call); when the brain outgrows the budget, older notes that share
 * words with the question are added. Chronological order, dated, so the model
 * can treat the newest of two conflicting notes as the update.
 */
export function selectNotes(notes: Note[], question: string): Note[] {
  const picked = new Set<string>()
  let used = 0
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]
    if (used + n.text.length > NOTES_CHAR_BUDGET) break
    picked.add(n.id)
    used += n.text.length
  }
  const rest = notes.filter((n) => !picked.has(n.id))
  if (rest.length > 0) {
    const q = tokens(question)
    const scored = rest
      .map((n) => {
        let hits = 0
        for (const t of tokens(n.text)) if (q.has(t)) hits++
        return { n, hits }
      })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || (a.n.ts < b.n.ts ? 1 : -1))
    let extra = 0
    for (const { n } of scored.slice(0, 20)) {
      if (extra + n.text.length > OLD_NOTES_CHAR_BUDGET) break
      picked.add(n.id)
      extra += n.text.length
    }
  }
  return notes.filter((n) => picked.has(n.id))
}

export function formatNotes(notes: Note[]): string {
  if (notes.length === 0) return '(none)'
  return notes.map((n) => `- [${n.ts.slice(0, 10)}] ${n.text.replace(/\s+/g, ' ')}`).join('\n')
}

/** Shared guard for the owner-only brain endpoints: false = response already sent. */
export async function guardBrain(req: any, res: any): Promise<boolean> {
  try {
    assertBrainAccess(req, BRAIN_SESSION_ID)
    return true
  } catch {
    await new Promise((r) => setTimeout(r, 600))
    res.status(403).json({ error: 'Owner passphrase required' })
    return false
  }
}
