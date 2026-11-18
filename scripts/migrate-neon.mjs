/**
 * One-shot, idempotent schema setup for the durable Neon driver.
 * Safe to run repeatedly and safe under concurrent serverless execution:
 * every statement is CREATE TABLE IF NOT EXISTS, which Postgres serializes
 * internally - no silent global DDL, no destructive changes, ever.
 *
 * Usage: RAG_DATABASE_URL=postgres://... node scripts/migrate-neon.mjs
 */
import { neon } from '@neondatabase/serverless'

const url = process.env.RAG_DATABASE_URL
if (!url) {
  console.error('RAG_DATABASE_URL is not set; nothing to migrate.')
  process.exit(1)
}

const sql = neon(url)

await sql`CREATE TABLE IF NOT EXISTS rag_docs (
  session_id text NOT NULL,
  url text NOT NULL,
  filename text NOT NULL,
  name text,
  size bigint,
  mime text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, url)
)`
await sql`CREATE TABLE IF NOT EXISTS rag_chunks (
  session_id text NOT NULL,
  idx integer NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding jsonb NOT NULL,
  PRIMARY KEY (session_id, idx)
)`
await sql`CREATE TABLE IF NOT EXISTS rag_files (
  session_id text NOT NULL,
  filename text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY (session_id, filename)
)`
await sql`CREATE TABLE IF NOT EXISTS rag_messages (
  session_id text NOT NULL,
  conversation_id text NOT NULL DEFAULT 'default',
  id bigserial PRIMARY KEY,
  role text NOT NULL,
  content text NOT NULL,
  sources jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)`
await sql`CREATE INDEX IF NOT EXISTS rag_messages_session_idx ON rag_messages (session_id, conversation_id, id)`
await sql`CREATE TABLE IF NOT EXISTS rag_notes (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`
await sql`CREATE INDEX IF NOT EXISTS rag_notes_session_idx ON rag_notes (session_id, id)`
// Retention index: lets the cleanup script find expired sessions fast.
await sql`CREATE INDEX IF NOT EXISTS rag_docs_created_at_idx ON rag_docs (created_at)`

console.log('Schema ready: rag_docs, rag_chunks, rag_files, rag_messages, rag_notes (idempotent).')
