// Owner-mode handler behavior with a configured (test) env. The wrong-token
// path must reject BEFORE any provider work - no network, no paid calls.
process.env.RAG_OWNER_TOKEN = 'test-token-0123456789abcdef'
process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-not-a-real-key-0000000000'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import * as mod from '../pages/api/query'

const handler: any = (mod as any).default?.default ?? (mod as any).default ?? mod

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    status(code) { this.statusCode = code; return this },
    setHeader(k, v) { this.headers[k] = v },
    write(chunk) { this.body += chunk; return true },
    json(obj) { this.body = JSON.stringify(obj); return this },
    end(chunk) { if (typeof chunk === 'string') this.body += chunk; return this },
  }
}

const sessionId = randomUUID()

// 1. Wrong owner token -> 403, after the uniform delay, no provider call.
{
  const res = fakeRes()
  const t0 = Date.now()
  await handler({ method: 'POST', body: { sessionId, query: 'hi', ownerToken: 'wrong-token' } }, res)
  assert.equal(res.statusCode, 403)
  assert.match(res.body, /Invalid owner token/)
  assert.ok(Date.now() - t0 >= 500, 'expected the brute-force delay')
}

// 2. Wrong token + valid BYOK key still rejects: no silent fallback.
{
  const res = fakeRes()
  await handler(
    { method: 'POST', body: { sessionId, query: 'hi', ownerToken: 'nope', anthropicKey: 'sk-ant-' + 'a'.repeat(40) } },
    res
  )
  assert.equal(res.statusCode, 403)
}

// 3. Right token reaches the provider path (fails with a sanitized 502
//    because the env key is fake) - proves the gate opens for the owner
//    and that provider errors never echo internals.
{
  const res = fakeRes()
  await handler(
    { method: 'POST', body: { sessionId, query: 'hi', ownerToken: 'test-token-0123456789abcdef' } },
    res
  )
  assert.equal(res.statusCode, 502)
  assert.match(res.body, /Anthropic/)
  assert.ok(!res.body.includes('FAKE-not-a-real-key'), 'key must never be echoed')
}

console.log('owner mode handler: all tests passed')
