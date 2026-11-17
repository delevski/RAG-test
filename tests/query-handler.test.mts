// Integration test for the /api/query handler. No network, no paid AI:
// runs with RAG_MOCK=1 so the mock provider streams the answer.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as mod from '../pages/api/query'
const m: any = mod as any
const handler: any = typeof m.default === 'function' ? m.default : m.default.default

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    status(code) { this.statusCode = code; return this },
    setHeader(k, v) { this.headers[k] = v },
    write(chunk) { this.body += chunk; return true },
    json(obj) { this.body = JSON.stringify(obj); return this },
    end(chunk) { if (typeof chunk === 'string') this.body += chunk; return this },
  }
}

const sessionId = randomUUID()

// 1. Method guard.
{
  const res = fakeRes()
  await handler({ method: 'GET', query: {}, body: {} }, res)
  assert.equal(res.statusCode, 405)
}

// 2. Malformed BYOK key is rejected before any provider work.
{
  const res = fakeRes()
  await handler(
    { method: 'POST', body: { sessionId, query: 'hi', anthropicKey: 'sk-openai-nope' } },
    res
  )
  assert.equal(res.statusCode, 400)
  assert.match(res.body, /Invalid Anthropic API key format/)
}

// 3. Oversized key rejected.
{
  const res = fakeRes()
  await handler(
    { method: 'POST', body: { sessionId, query: 'hi', anthropicKey: 'sk-ant-' + 'x'.repeat(600) } },
    res
  )
  assert.equal(res.statusCode, 400)
}

// 4. Mock provider streams an answer for a chat-mode question.
{
  const res = fakeRes()
  await handler({ method: 'POST', body: { sessionId, query: 'What can you do?' } }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.length > 20, 'expected a streamed mock answer')
}

// 5. expectContext with no index -> 409 INDEX_MISSING (no silent re-embed).
{
  const res = fakeRes()
  await handler(
    { method: 'POST', body: { sessionId: randomUUID(), query: 'summarize', expectContext: true } },
    res
  )
  assert.equal(res.statusCode, 409)
  assert.match(res.body, /INDEX_MISSING/)
}

// 6. Missing query -> 400.
{
  const res = fakeRes()
  await handler({ method: 'POST', body: { sessionId } }, res)
  assert.equal(res.statusCode, 400)
}

console.log('query handler integration: all tests passed')
