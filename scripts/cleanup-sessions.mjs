/**
 * Bounded retention: removes sessions (docs + chunks + file bytes) whose
 * newest document is older than RAG_SESSION_TTL_DAYS (default 30). Run on a
 * schedule (e.g. Vercel Cron daily) or manually:
 *   RAG_DATABASE_URL=postgres://... node scripts/cleanup-sessions.mjs
 * Storage is bounded by design: 10 docs/session x ~4.5 MB upload cap, so a
 * session can never exceed ~45 MB of file bytes plus chunk text.
 */
import { neon } from '@neondatabase/serverless'

const url = process.env.RAG_DATABASE_URL
if (!url) {
  console.error('RAG_DATABASE_URL is not set; nothing to clean.')
  process.exit(1)
}
const ttlDays = Number(process.env.RAG_SESSION_TTL_DAYS || 30)
const sql = neon(url)

const expired = await sql`
  SELECT session_id FROM rag_docs
  GROUP BY session_id
  HAVING max(created_at) < now() - make_interval(days => ${ttlDays})`
for (const row of expired) {
  await sql`DELETE FROM rag_chunks WHERE session_id = ${row.session_id}`
  await sql`DELETE FROM rag_files WHERE session_id = ${row.session_id}`
  await sql`DELETE FROM rag_docs WHERE session_id = ${row.session_id}`
}
console.log(`Removed ${expired.length} expired session(s) (TTL ${ttlDays}d).`)
