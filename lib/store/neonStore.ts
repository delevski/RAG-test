import type { SessionDocRecord, SessionSnapshot, SessionStore, StoredMessage } from './sessionStore'
import type { StoredChunk } from '@/lib/vectorstore/jsonVectorStore'
import { assertValidSessionId } from './fileStore'

/**
 * Durable driver: Neon serverless Postgres (free tier, no credit card).
 * Activated only when RAG_DATABASE_URL is set explicitly. The schema is
 * created lazily on first use, so a fresh database needs zero manual steps.
 *
 * Embeddings are stored as JSONB arrays and similarity runs in JS at query
 * time — deliberate at portfolio scale (a session holds at most 1500
 * chunks). The documented scale path is pgvector with an ivfflat index.
 */

type SqlFn = ((strings: TemplateStringsArray, ...params: any[]) => Promise<any[]>) & {
  // neon's HTTP driver transaction: an array of (unawaited) queries, or a
  // function returning one. NOT an interactive callback - see saveSession.
  transaction?: (queries: any[]) => Promise<any>
}

export class NeonSessionStore implements SessionStore {
  readonly driver = 'neon' as const
  private sql: SqlFn
  private schemaReady: Promise<void> | null = null

  constructor(url: string, sqlOverride?: SqlFn) {
    if (sqlOverride) {
      this.sql = sqlOverride
    } else {
      // Loaded lazily so the package is only required when the driver is on.
      // eslint-disable-next-line
      const { neon } = require('@neondatabase/serverless')
      this.sql = neon(url)
    }
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`CREATE TABLE IF NOT EXISTS rag_docs (
          session_id text NOT NULL,
          url text NOT NULL,
          filename text NOT NULL,
          name text,
          size bigint,
          mime text,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (session_id, url)
        )`
        await this.sql`CREATE TABLE IF NOT EXISTS rag_chunks (
          session_id text NOT NULL,
          idx integer NOT NULL,
          content text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          embedding jsonb NOT NULL,
          PRIMARY KEY (session_id, idx)
        )`
        await this.sql`CREATE TABLE IF NOT EXISTS rag_messages (
          session_id text NOT NULL,
          id bigserial PRIMARY KEY,
          role text NOT NULL,
          content text NOT NULL,
          sources jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )`
        await this.sql`CREATE INDEX IF NOT EXISTS rag_messages_session_idx ON rag_messages (session_id, id)`
        await this.sql`CREATE TABLE IF NOT EXISTS rag_files (
          session_id text NOT NULL,
          filename text NOT NULL,
          content bytea NOT NULL,
          PRIMARY KEY (session_id, filename)
        )`
      })()
    }
    return this.schemaReady
  }

  async loadSession(sessionId: string): Promise<SessionSnapshot | null> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    const docRows = await this.sql`
      SELECT url, filename, name, size, mime FROM rag_docs
      WHERE session_id = ${sessionId} ORDER BY created_at ASC`
    const chunkRows = await this.sql`
      SELECT content, metadata, embedding FROM rag_chunks
      WHERE session_id = ${sessionId} ORDER BY idx ASC`
    // Memory-only spaces (second brain) can hold chunks before any document.
    if (docRows.length === 0 && chunkRows.length === 0) return null
    const docs: SessionDocRecord[] = docRows.map((r: any) => ({
      url: r.url,
      filename: r.filename,
      name: r.name ?? undefined,
      size: r.size == null ? undefined : Number(r.size),
      type: r.mime ?? undefined,
    }))
    const chunks: StoredChunk[] = chunkRows.map((r: any) => ({
      content: r.content,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
    }))
    return { docs, chunks }
  }

  async saveSession(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    // Docs and chunks are rewritten wholesale per save: an upsert-only write
    // can never remove rows, which resurrected deleted docs on hydration.
    // The whole rewrite runs in ONE transaction so a concurrent save for the
    // same session serializes instead of interleaving DELETE/INSERT phases.
    // IMPORTANT: neon's HTTP sql.transaction expects an ARRAY of queries (or a
    // function returning one) - a callback that awaits tx`` itself silently
    // executes nothing. Build the array first, then hand it over. Bounded by
    // MAX_DOCS_PER_SESSION (10) and MAX_CHUNKS_PER_SESSION (1500).
    const queries: any[] = [
      this.sql`DELETE FROM rag_docs WHERE session_id = ${sessionId}`,
    ]
    for (const d of snapshot.docs) {
      queries.push(this.sql`
        INSERT INTO rag_docs (session_id, url, filename, name, size, mime)
        VALUES (${sessionId}, ${d.url}, ${d.filename}, ${d.name ?? null},
                ${d.size ?? null}, ${d.type ?? null})`)
    }
    queries.push(this.sql`DELETE FROM rag_chunks WHERE session_id = ${sessionId}`)
    for (let i = 0; i < snapshot.chunks.length; i++) {
      const ch = snapshot.chunks[i]
      queries.push(this.sql`
        INSERT INTO rag_chunks (session_id, idx, content, metadata, embedding)
        VALUES (${sessionId}, ${i}, ${ch.content},
                ${JSON.stringify(ch.metadata ?? {})}::jsonb,
                ${JSON.stringify(ch.embedding)}::jsonb)`)
    }
    if (this.sql.transaction) {
      await this.sql.transaction(queries)
    } else {
      for (const q of queries) await q
    }
  }

  async putFile(sessionId: string, filename: string, content: Buffer): Promise<void> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    await this.sql`
      INSERT INTO rag_files (session_id, filename, content)
      VALUES (${sessionId}, ${filename}, ${content})
      ON CONFLICT (session_id, filename) DO UPDATE SET content = EXCLUDED.content`
  }

  async deleteFile(sessionId: string, filename: string): Promise<void> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    await this.sql`DELETE FROM rag_files WHERE session_id = ${sessionId} AND filename = ${filename}`
  }

  async getFile(sessionId: string, filename: string): Promise<Buffer | null> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    const rows = await this.sql`
      SELECT content FROM rag_files WHERE session_id = ${sessionId} AND filename = ${filename}`
    if (rows.length === 0) return null
    const c = rows[0].content
    return Buffer.isBuffer(c) ? c : Buffer.from(c)
  }

  async appendDocsAndChunks(
    sessionId: string,
    docs: SessionDocRecord[],
    chunks: StoredChunk[]
  ): Promise<void> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    const queries: any[] = []
    for (const d of docs) {
      queries.push(this.sql`
        INSERT INTO rag_docs (session_id, url, filename, name, size, mime)
        VALUES (${sessionId}, ${d.url}, ${d.filename}, ${d.name ?? null},
                ${d.size ?? null}, ${d.type ?? null})
        ON CONFLICT (session_id, url) DO NOTHING`)
    }
    // idx continues after the current maximum; computed inside each INSERT so
    // appended rows can never collide with or overwrite existing chunks.
    for (const ch of chunks) {
      queries.push(this.sql`
        INSERT INTO rag_chunks (session_id, idx, content, metadata, embedding)
        VALUES (${sessionId},
                (SELECT COALESCE(MAX(idx), -1) + 1 FROM rag_chunks WHERE session_id = ${sessionId}),
                ${ch.content},
                ${JSON.stringify(ch.metadata ?? {})}::jsonb,
                ${JSON.stringify(ch.embedding)}::jsonb)`)
    }
    if (queries.length === 0) return
    if (this.sql.transaction) await this.sql.transaction(queries)
    else for (const q of queries) await q
  }

  async appendMessages(sessionId: string, messages: StoredMessage[]): Promise<void> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    const queries: any[] = messages.map((m) => this.sql`
      INSERT INTO rag_messages (session_id, role, content, sources, created_at)
      VALUES (${sessionId}, ${m.role}, ${m.content},
              ${m.sources ? JSON.stringify(m.sources) : null}::jsonb, ${m.ts}::timestamptz)`)
    if (queries.length === 0) return
    if (this.sql.transaction) await this.sql.transaction(queries)
    else for (const q of queries) await q
  }

  async listMessages(sessionId: string, limit: number): Promise<StoredMessage[]> {
    assertValidSessionId(sessionId)
    await this.ensureSchema()
    const rows = await this.sql`
      SELECT role, content, sources, created_at FROM rag_messages
      WHERE session_id = ${sessionId} ORDER BY id DESC LIMIT ${limit}`
    return rows.reverse().map((r: any) => ({
      role: r.role,
      content: r.content,
      ts: new Date(r.created_at).toISOString(),
      sources: r.sources == null ? undefined : typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources,
    }))
  }
}
