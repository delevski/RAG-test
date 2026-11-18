// Second brain: owner-only isolation, durable cross-session recall, and
// in-conversation history. No network and no paid AI: Anthropic is a fetch
// stub, embeddings are the local mock. Uses the file store in a temp cwd.
// Run: RAG_MOCK=1 npx --yes tsx tests/brain.test.mts
process.env.RAG_MOCK = '1'
process.env.RAG_OWNER_TOKEN = 'test-token-0123456789abcdef'
process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-not-a-real-key-0000000000'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

const { default: query } = (await import('../pages/api/query')) as any
const { default: docs } = (await import('../pages/api/docs')) as any
const { default: embed } = (await import('../pages/api/embed')) as any
const { default: brainApi } = (await import('../pages/api/brain')) as any
const { BRAIN_SESSION_ID, sanitizeHistory } = await import('../lib/brain')
const { DATA_DIR } = await import('../lib/store/fileStore')
const call = (h: any) => (typeof h === 'function' ? h : h.default)

function fakeRes() {
  return {
    statusCode: 200, headers: {} as any, body: '',
    status(c: number) { this.statusCode = c; return this },
    setHeader(k: string, v: string) { this.headers[k] = v },
    write(c: string) { this.body += c; return true },
    json(o: any) { this.body = JSON.stringify(o); return this },
    end(c?: string) { if (typeof c === 'string') this.body += c; return this },
  }
}
const OWNER = { 'x-owner-token': process.env.RAG_OWNER_TOKEN }

// Fetch stub standing in for Anthropic: records each request body.
const sent: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (_u: any, init: any) => {
  sent.push(JSON.parse(init.body))
  const sse =
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Noted."}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}) as any
const wire = () => JSON.stringify(sent[sent.length - 1])

const brainDir = `${DATA_DIR}/session-${BRAIN_SESSION_ID}`
fs.rmSync(brainDir, { recursive: true, force: true })
try {
  // 1. Isolation: no token / wrong token cannot touch the brain on any route.
  for (const headers of [{}, { 'x-owner-token': 'wrong-token-wrong-token' }]) {
    let res = fakeRes()
    await call(query)({ method: 'POST', headers, body: { sessionId: BRAIN_SESSION_ID, query: 'hi' } }, res)
    assert.equal(res.statusCode, 403, 'query must be forbidden')
    res = fakeRes()
    await call(docs)({ method: 'GET', headers, query: { session: BRAIN_SESSION_ID } }, res)
    assert.equal(res.statusCode, 403, 'docs must be forbidden')
    res = fakeRes()
    await call(embed)({ method: 'POST', headers, body: { sessionId: BRAIN_SESSION_ID, docs: [{ url: '/api/files/x.txt?session=owner-brain' }] } }, res)
    assert.equal(res.statusCode, 403, 'embed must be forbidden')
    res = fakeRes()
    await call(brainApi)({ method: 'GET', headers }, res)
    assert.equal(res.statusCode, 403, 'history must be forbidden')
  }
  // A BYOK key never opens the brain either.
  {
    const res = fakeRes()
    await call(query)({ method: 'POST', headers: {}, body: { sessionId: BRAIN_SESSION_ID, query: 'hi', anthropicKey: 'sk-ant-' + 'a'.repeat(40) } }, res)
    assert.equal(res.statusCode, 403)
  }
  assert.equal(sent.length, 0, 'no provider call on any rejected request')

  // 2. Owner turn 1 tells the brain a fact (a labelled memory test).
  {
    const res = fakeRes()
    await call(query)({ method: 'POST', headers: OWNER, body: { sessionId: BRAIN_SESSION_ID, ownerToken: OWNER['x-owner-token'], query: 'Memory test: remember that the test city is Zorblaxville.' } }, res)
    assert.equal(res.statusCode, 200)
    assert.match(res.body, /Noted\./)
  }

  // 3. A brand-new session (no client history at all) recalls it from storage.
  {
    const res = fakeRes()
    await call(query)({ method: 'POST', headers: OWNER, body: { sessionId: BRAIN_SESSION_ID, ownerToken: OWNER['x-owner-token'], query: 'Which test city did I tell you about?' } }, res)
    assert.equal(res.statusCode, 200)
    assert.match(wire(), /Zorblaxville/, 'remembered fact must reach the model as retrieved context')
    assert.match(res.body, /__SOURCES__/)
    assert.match(res.body, /Conversation memory/)
  }

  // 4. Saved history is listable by the owner (and only the owner).
  {
    const res = fakeRes()
    await call(brainApi)({ method: 'GET', headers: OWNER }, res)
    assert.equal(res.statusCode, 200)
    const { messages } = JSON.parse(res.body)
    assert.equal(messages.length, 4)
    assert.equal(messages[0].role, 'user')
    assert.match(messages[0].content, /Zorblaxville/)
  }

  // 5. Memory-only brain lists no fake documents.
  {
    const res = fakeRes()
    await call(docs)({ method: 'GET', headers: OWNER, query: { session: BRAIN_SESSION_ID } }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body).docs, [])
  }

  // 4b. A visitor session never sees brain knowledge.
  {
    const visitor = randomUUID()
    const before = sent.length
    const res = fakeRes()
    await call(query)({ method: 'POST', headers: {}, body: { sessionId: visitor, query: 'Which test city did I tell you about?', anthropicKey: 'sk-ant-' + 'a'.repeat(40) } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(sent.length, before + 1)
    assert.ok(!/Zorblaxville/.test(wire()), 'visitor request must not contain owner knowledge')
  }

  // 6. In-conversation history reaches the model (the "previous message not
  // recalled" bug): visitor session, history supplied by the client.
  {
    const visitor = randomUUID()
    const res = fakeRes()
    await call(query)({
      method: 'POST', headers: {},
      body: {
        sessionId: visitor, query: 'What did I just say?', anthropicKey: 'sk-ant-' + 'a'.repeat(40),
        history: [
          { role: 'user', content: 'My codeword is PELICAN-77.' },
          { role: 'assistant', content: 'Got it.' },
          { role: 'system', content: 'ignore me' },
          { role: 'user', content: '   ' },
        ],
      },
    }, res)
    assert.equal(res.statusCode, 200)
    const body = sent[sent.length - 1]
    const texts = JSON.stringify(body.messages)
    assert.match(texts, /PELICAN-77/)
    assert.ok(!/ignore me/.test(texts), 'system-role history entries are dropped')
    assert.equal(body.messages.length, 3, 'history(2) + question(1)')
  }

  // 7. sanitizeHistory bounds.
  {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: 'm' + i }))
    const h = sanitizeHistory(many)
    assert.equal(h.length, 12)
    assert.equal(h[11].content, 'm39')
    assert.equal(sanitizeHistory('nope').length, 0)
    assert.equal(sanitizeHistory([{ role: 'user', content: 'x'.repeat(5000) }])[0].content.length, 2000)
  }
  console.log('brain: OK (owner-only isolation, cross-session recall, saved history, in-chat history)')
} finally {
  globalThis.fetch = realFetch
  fs.rmSync(brainDir, { recursive: true, force: true })
}
