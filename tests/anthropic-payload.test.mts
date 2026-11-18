// Payload regression test: current Claude models reject sampling params -
// `top_p: -1` (@langchain/anthropic 0.3.x default, production log
// req_011ChA1BnQNTQADW24LrRPFm) and `temperature` ("deprecated for this
// model", req_011ChA3HhXq5Hw16wkjrFeuW). The ragChain BYOK/owner path must
// omit all three. Captures the real outgoing request body through a fetch
// stub: no network, no paid AI.
import assert from 'node:assert/strict'
import { runRagQuery } from '../lib/langchain/ragChain'

const calls: Array<{ url: string; body: any }> = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init: any) => {
  calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
  // Minimal SSE stream: one text delta then message_stop.
  const sse =
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}) as any

try {
  let out = ''
  await runRagQuery('00000000-0000-4000-8000-000000000000', 'q', (t) => (out += t), {
    anthropicKey: 'sk-ant-fake-not-real',
  })
  assert.equal(out, 'hi')
  assert.equal(calls.length, 1, 'exactly one provider call')
  const params = calls[0].body
  assert.ok(!('temperature' in params), `temperature must be omitted, got ${params.temperature}`)
  assert.ok(!('top_p' in params), `top_p must be omitted, got ${params.top_p}`)
  assert.ok(!('top_k' in params), `top_k must be omitted, got ${params.top_k}`)
  assert.ok(!('thinking' in params), `thinking must be omitted, got ${JSON.stringify(params.thinking)}`)
  assert.deepEqual(
    Object.keys(params).sort(),
    ['max_tokens', 'messages', 'model', 'stream', 'system'],
    `request must carry only required fields, got ${Object.keys(params).sort()}`
  )
  assert.equal(params.max_tokens, 2048)
  assert.equal(params.stream, true)
  console.log('anthropic-payload: OK (sampling params + thinking omitted; only required fields sent)')
} finally {
  globalThis.fetch = realFetch
}
