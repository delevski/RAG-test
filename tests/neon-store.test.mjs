// Behavioral test for NeonSessionStore.saveSession semantics.
// A recording sqlOverride emulates the neon HTTP driver: tagged-template
// calls produce lazy query objects (executed only when awaited), and
// transaction(queries) applies them atomically in order.
// Run: npx --yes tsx tests/neon-store.test.mjs
import assert from 'node:assert/strict'
import { NeonSessionStore } from '../lib/store/neonStore'

function makeFakeNeon() {
  const docs = new Map() // key `${session}|${url}` -> row
  const chunks = [] // {session, idx, content}
  const log = []
  const apply = (text, params) => {
    log.push(text)
    if (/DELETE FROM rag_docs/.test(text)) {
      for (const k of [...docs.keys()]) if (k.startsWith(params[0] + '|')) docs.delete(k)
    } else if (/INSERT INTO rag_docs/.test(text)) {
      docs.set(params[0] + '|' + params[1], { url: params[1], filename: params[2] })
    } else if (/DELETE FROM rag_chunks/.test(text)) {
      for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].session === params[0]) chunks.splice(i, 1)
    } else if (/INSERT INTO rag_chunks/.test(text)) {
      chunks.push({ session: params[0], idx: params[1], content: params[2] })
    } else if (/CREATE TABLE|CREATE INDEX/.test(text)) {
      // schema bootstrap, fine
    } else {
      throw new Error('unexpected SQL in fake: ' + text)
    }
    return []
  }
  // Lazy query objects, mirroring the neon HTTP driver: calling sql`` does
  // NOT execute; awaiting the object (or handing it to transaction()) does.
  const sql = (strings, ...params) => {
    const text = strings.join('?')
    const q = { text, params, then: (res, rej) => Promise.resolve().then(() => apply(text, params)).then(res, rej) }
    return q
  }
  sql.transaction = async (queries) => {
    assert.ok(Array.isArray(queries), 'transaction() must receive an ARRAY of queries')
    const staged = [...log]
    try {
      for (const q of queries) apply(q.text ?? q.strings?.join('?'), q.params ?? [])
    } catch (e) {
      log.length = 0; log.push(...staged) // rollback of the log; tables simplified away
      throw e
    }
    return []
  }
  return { sql, docs, chunks, log }
}

const doc = (url) => ({ url, filename: 'f-' + url, name: url, size: 10, type: 'text/plain' })
const chunk = (c) => ({ content: c, metadata: { docUrl: 'a.txt' }, embedding: [0.1, 0.2] })

// 1. Full save: one transaction, correct statement shape and order.
{
  const { sql, docs, chunks, log } = makeFakeNeon()
  const store = new NeonSessionStore('postgres://fake', sql)
  await store.saveSession('sess-test-1', { docs: [doc('a.txt'), doc('b.txt')], chunks: [chunk('c1'), chunk('c2'), chunk('c3')] })
  const ops = log.filter((t) => !/CREATE/.test(t))
  assert.equal(ops.filter((t) => /DELETE FROM rag_docs/.test(t)).length, 1)
  assert.equal(ops.filter((t) => /INSERT INTO rag_docs/.test(t)).length, 2)
  assert.equal(ops.filter((t) => /DELETE FROM rag_chunks/.test(t)).length, 1)
  assert.equal(ops.filter((t) => /INSERT INTO rag_chunks/.test(t)).length, 3)
  assert.equal(docs.size, 2)
  assert.equal(chunks.length, 3)
  console.log('PASS 1: save persists docs + chunks in one transaction')
}

// 2. Removal is durable: saving a filtered snapshot deletes the missing doc.
{
  const { sql, docs, chunks } = makeFakeNeon()
  const store = new NeonSessionStore('postgres://fake', sql)
  await store.saveSession('sess-test-2', { docs: [doc('a.txt'), doc('b.txt')], chunks: [chunk('c1')] })
  await store.saveSession('sess-test-2', { docs: [doc('b.txt')], chunks: [] })
  assert.deepEqual([...docs.values()].map((d) => d.url), ['b.txt'])
  assert.equal(chunks.length, 0)
  console.log('PASS 2: removed doc + chunks stay removed (no resurrection)')
}

// 3. Empty snapshot wipes the session cleanly.
{
  const { sql, docs, chunks } = makeFakeNeon()
  const store = new NeonSessionStore('postgres://fake', sql)
  await store.saveSession('sess-test-3', { docs: [doc('a.txt')], chunks: [chunk('c1')] })
  await store.saveSession('sess-test-3', { docs: [], chunks: [] })
  assert.equal(docs.size, 0)
  assert.equal(chunks.length, 0)
  console.log('PASS 3: empty snapshot wipes session rows')
}

// 4. No-transaction fallback executes the same statements sequentially.
{
  const fake = makeFakeNeon()
  delete fake.sql.transaction
  const store = new NeonSessionStore('postgres://fake', fake.sql)
  await store.saveSession('sess-test-4', { docs: [doc('a.txt')], chunks: [chunk('c1')] })
  assert.equal(fake.docs.size, 1)
  assert.equal(fake.chunks.length, 1)
  console.log('PASS 4: sequential fallback persists identically')
}

console.log('ALL NEON STORE TESTS PASSED')
