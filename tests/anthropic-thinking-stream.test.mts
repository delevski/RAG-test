// Thinking-block regression test: on Claude Haiku 5.5 thinking is adaptive
// and ON by default, so a request that omits `thinking` may get thinking
// content blocks streamed back. StringOutputParser then crashes the whole
// answer with
//   Cannot coerce "thinking" message part into a string.
// (production /api/query log, NOV 18 10:13:40 + 10:13:58, owner mode with
// document context). The ragChain BYOK/owner path must (a) explicitly send
// thinking: {type:"disabled"} - accepted on Haiku 5.5 at the default
// (medium) effort per https://docs.anthropic.com/en/docs/build-with-claude/thinking
// - and (b) drop non-text parts while never succeeding with an empty answer.
// Simulated SSE streams: no network, no paid AI.
import assert from 'node:assert/strict'
import { runRagQuery } from '../lib/langchain/ragChain'

const sseHead =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-haiku-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n'
const thinkingBlock =
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig"}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm, the user asks about a CV"}}\n\n' +
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n'
const textBlock =
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n'
const sseTail = 'event: message_stop\ndata: {"type":"message_stop"}\n\n'

async function runWithSse(sse: string) {
  const calls: Array<{ url: string; body: any }> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as any
  try {
    let out = ''
    await runRagQuery('00000000-0000-4000-8000-000000000000', 'q', (t) => (out += t), {
      anthropicKey: 'sk-ant-fake-not-real',
    })
    return { out, calls, error: null as any }
  } catch (error) {
    return { out: '', calls, error }
  } finally {
    globalThis.fetch = realFetch
  }
}

// 1. thinking block + text: answer text streams, thinking is dropped,
//    and the request explicitly disables thinking.
{
  const { out, calls, error } = await runWithSse(sseHead + thinkingBlock + textBlock + sseTail)
  assert.ifError(error)
  assert.equal(out, 'hi', `answer text must stream despite a thinking block, got ${JSON.stringify(out)}`)
  assert.equal(calls.length, 1, 'exactly one provider call')
  assert.deepEqual(
    calls[0].body.thinking,
    { type: 'disabled' },
    `request must explicitly disable thinking, got ${JSON.stringify(calls[0].body.thinking)}`
  )
}

// 2. thinking-only response (no text at all): loud failure, never a silent
//    empty answer.
{
  const { error } = await runWithSse(sseHead + thinkingBlock + sseTail)
  assert.ok(error, 'a textless response must throw')
  assert.equal(error.message, 'EMPTY_MODEL_RESPONSE')
}

console.log('anthropic-thinking-stream: OK (thinking dropped, text streamed, thinking disabled in request, textless response fails loudly)')
