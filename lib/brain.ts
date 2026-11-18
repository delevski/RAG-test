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
  return sessionId === BRAIN_SESSION_ID
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
