import type { StoredChunk } from '@/lib/vectorstore/jsonVectorStore'

/**
 * Session persistence abstraction.
 *
 * Two drivers:
 *  - file (default): JSON + uploads under the local data dir. Durable across
 *    restarts on one machine; on serverless platforms the data dir lives in
 *    /tmp, so it survives warm invocations but NOT cold starts.
 *  - neon (durable): Postgres via @neondatabase/serverless, activated when
 *    POSTGRES_URL or DATABASE_URL is set. Documents, chunk embeddings and
 *    original file bytes survive any restart or cold start. Neon is free
 *    with no credit card (verified on their pricing page), and the schema
 *    self-creates on first use.
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

export interface SessionStore {
  readonly driver: 'file' | 'neon'
  loadSession(sessionId: string): Promise<SessionSnapshot | null>
  saveSession(sessionId: string, snapshot: SessionSnapshot): Promise<void>
  putFile(sessionId: string, filename: string, content: Buffer): Promise<void>
  getFile(sessionId: string, filename: string): Promise<Buffer | null>
  deleteFile(sessionId: string, filename: string): Promise<void>
}

let active: SessionStore | null = null

export async function getSessionStore(): Promise<SessionStore> {
  if (active) return active
  const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (pgUrl) {
    const { NeonSessionStore } = await import('./neonStore')
    active = new NeonSessionStore(pgUrl)
  } else {
    const { FileSessionStore } = await import('./fileStore')
    active = new FileSessionStore()
  }
  return active
}

/** Test hook: reset the cached driver between scenarios. */
export function __resetSessionStoreForTests() {
  active = null
}
