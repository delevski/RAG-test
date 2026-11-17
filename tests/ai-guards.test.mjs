// Behavioral tests for the AI provider guards.
// Run BOTH ways (the mock/real split is read at module load):
//   npx --yes tsx tests/ai-guards.test.mjs            # real-provider branch
//   RAG_MOCK=1 npx --yes tsx tests/ai-guards.test.mjs # mock branch
import assert from 'node:assert/strict'
import {
  paidAIAllowed,
  PAID_AI_DISABLED,
  activeEmbeddingSpec,
  assertEmbeddingCompatibility,
  EMBEDDING_MODE_MISMATCH,
  RAG_MOCK_ENABLED,
} from '../lib/ai/mock'
import { runRagQuery } from '../lib/langchain/ragChain'

// 1. Paid guard is fail-closed and lazy (env read at call time).
{
  delete process.env.RAG_ALLOW_PAID
  assert.equal(paidAIAllowed(), false)
  process.env.RAG_ALLOW_PAID = '1'
  assert.equal(paidAIAllowed(), true)
  delete process.env.RAG_ALLOW_PAID
  console.log('PASS 1: paid guard defaults closed, opens only on explicit RAG_ALLOW_PAID=1')
}

// 2. Embedding spec identifies the active mode and dimension.
{
  const spec = activeEmbeddingSpec()
  if (RAG_MOCK_ENABLED) {
    assert.deepEqual(spec, { model: 'mock-bow-hash', dim: 128 })
  } else {
    assert.equal(spec.dim, 1536) // text-embedding-3-small default
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large'
    assert.equal(activeEmbeddingSpec().dim, 3072)
    delete process.env.OPENAI_EMBEDDING_MODEL
  }
  console.log('PASS 2: active embedding spec reports model + dimension')
}

// 3. Compatibility validation: same dim passes, mismatch throws an
//    actionable error, and no data is touched (validation only).
{
  assertEmbeddingCompatibility([128, 128], { model: 'mock-bow-hash', dim: 128 })
  assertEmbeddingCompatibility([], { model: 'mock-bow-hash', dim: 128 })
  assert.throws(
    () => assertEmbeddingCompatibility([128], { model: 'text-embedding-3-small', dim: 1536 }),
    (e) => e.message.startsWith(EMBEDDING_MODE_MISMATCH) && e.message.includes('128') && e.message.includes('1536')
  )
  console.log('PASS 3: embedding dimension mismatch detected loudly, never purged')
}

// 4. Chat path: mock mode streams without any paid call; real mode without
//    RAG_ALLOW_PAID throws before constructing the client (no network).
{
  let streamed = ''
  if (RAG_MOCK_ENABLED) {
    const r = await runRagQuery('sess-guard-test', 'hello', (t) => (streamed += t), {})
    assert.ok(streamed.includes('Mock answer'))
    assert.equal(r.usedContext, false)
    console.log('PASS 4: mock mode answers with zero paid calls')
  } else {
    await assert.rejects(
      () => runRagQuery('sess-guard-test', 'hello', (t) => (streamed += t), {}),
      (e) => e.message.startsWith('PAID_AI_DISABLED')
    )
    assert.equal(streamed, '')
    console.log('PASS 4: real chat path refuses before any paid call (fail-closed)')
  }
}

console.log('ALL AI GUARD TESTS PASSED')
