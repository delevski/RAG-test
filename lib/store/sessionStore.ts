import type { StoredChunk } from '@/lib/vectorstore/jsonVectorStore'

/**
 * Session persistence abstraction.
 *
 * Two drivers:
 *  - file (default): JSON + uploads under the local data dir. Durable across
 *    restarts on one machine; on serverless platforms the data dir lives in
 *    /tmp, so it survives warm invocations but NOT cold starts.
 *  - neon (durable): Postgres via @neondatabase/serverless, activated ONLY
 *    by app-scoped variables: RAG_DATABASE_URL (explicit, preferred), with
 *    RAG_DATABASE_POSTGRES_URL as the fallback emitted by the Vercel-Neon
 *    integration when its env prefix is RAG_DATABASE. We deliberately do NOT
 *    auto-detect generic POSTGRES_URL / DATABASE_URL variables: an unrelated
 *    database must never become this app's store by accident.
 *    Documents, chunk embeddings and original file bytes survive any
 *    restart or cold start. Neon is free with no credit card (verified on
 *    their pricing page), and the schema is created by scripts/migrate-neon.mjs
 *    (idempotent; the driver also applies it lazily as a safety net).
 *
 * The driver is chosen once per process from the environment; the API layer
 * never cares which one is active.
 */

export type SessionDocRecord = {
  url: string
  filename: string
  name?: string
  size?: number
  type?: string
}

export type SessionSnapshot = {
  docs: SessionDocRecord[]
  chunks: StoredChunk[]
}

export type StoredMessage = {
  role: 'user' | 'assistant'
  content: string
  /** ISO timestamp. */
  ts: string
  sources?: Array<{ name: string; snippet: string }>
}

export type StoredConversation = { id: string; title: string; updatedAt: string; count: number }
export type StoredNote = { id: string; text: string; ts: string }

export interface SessionStore {
  readonly driver: 'file' | 'neon'
  loadSession(sessionId: string): Promise<SessionSnapshot | null>
  saveSession(sessionId: string, snapshot: SessionSnapshot): Promise<void>
  putFile(sessionId: string, filename: string, content: Buffer): Promise<void>
  getFile(sessionId: string, filename: string): Promise<Buffer | null>
  deleteFile(sessionId: string, filename: string): Promise<void>
  /**
   * Incremental write (second brain): add docs and chunks WITHOUT rewriting
   * what is already stored, so a growing knowledge base never gets reshuffled.
   */
  appendDocsAndChunks(
    sessionId: string,
    docs: SessionDocRecord[],
    chunks: StoredChunk[]
  ): Promise<void>
  /** Durable chat history per conversation, oldest first (the last `limit` messages). */
  appendMessages(sessionId: string, conversationId: string, messages: StoredMessage[]): Promise<void>
  listMessages(sessionId: string, conversationId: string, limit: number): Promise<StoredMessage[]>
  listConversations(sessionId: string): Promise<StoredConversation[]>
  deleteConversation(sessionId: string, conversationId: string): Promise<void>
  /** Memory notes (second brain): plain facts the owner told the brain. */
  addNote(sessionId: string, text: string): Promise<StoredNote>
  listNotes(sessionId: string): Promise<StoredNote[]>
  deleteNote(sessionId: string, noteId: string): Promise<boolean>
  /**
   * Forgetting: remove saved chat messages where the user said exactly this
   * statement (compared on the first 1000 chars, like notes) and the assistant
   * reply directly after each. Returns how many messages were removed.
   */
  scrubStatement(sessionId: string, text: string): Promise<number>
}

let active: SessionStore | null = null

export async function getSessionStore(): Promise<SessionStore> {
  if (active) return active
  const pgUrl =
    process.env.RAG_DATABASE_URL || process.env.RAG_DATABASE_POSTGRES_URL
  if (pgUrl) {
    const { NeonSessionStore } = await import('./neonStore')
    active = new NeonSessionStore(pgUrl)
  } else {
    // Fail loud in production: the file driver is ephemeral on serverless,
    // so silently falling back would lose every document on the next cold
    // start - the exact bug this layer exists to fix. Preview and local
    // development keep the file driver as the documented demo mode.
    if (process.env.VERCEL_ENV === 'production' && process.env.RAG_ALLOW_EPHEMERAL !== '1') {
      throw new Error(
        'RAG_STORAGE_UNCONFIGURED: no durable store is configured for Production. ' +
          'Extend RAG_DATABASE_URL / RAG_DATABASE_POSTGRES_URL to the Production environment ' +
          '(Vercel > Project > Settings > Environment Variables). ' +
          'Falling back to the ephemeral file driver would lose all documents on the next cold start. ' +
          'Set RAG_ALLOW_EPHEMERAL=1 only to accept that data loss deliberately.'
      )
    }
    const { FileSessionStore } = await import('./fileStore')
    active = new FileSessionStore()
  }
  return active
}

/** Test hook: reset the cached driver between scenarios. */
export function __resetSessionStoreForTests() {
  active = null
}
