// Owner-mode key resolution tests. No network, no paid AI.
import assert from 'node:assert/strict'
import {
  resolveClaudeKey,
  ownerModeConfigured,
  ownerTokenMatches,
  OWNER_TOKEN_INVALID,
  OWNER_MODE_NOT_CONFIGURED,
} from '../lib/ai/ownerKey'

const env = { ANTHROPIC_API_KEY: 'sk-ant-server-key-000000000', RAG_OWNER_TOKEN: 'correct-horse-battery' } as any

// Configured detection.
assert.equal(ownerModeConfigured(env), true)
assert.equal(ownerModeConfigured({} as any), false)
assert.equal(ownerModeConfigured({ ANTHROPIC_API_KEY: 'x' } as any), false)

// Matching owner token resolves to the server key.
{
  const r = resolveClaudeKey({ ownerToken: 'correct-horse-battery' }, env)
  assert.deepEqual(r, { key: 'sk-ant-server-key-000000000', source: 'owner' })
}

// Owner token beats a supplied BYOK key.
{
  const r = resolveClaudeKey({ ownerToken: 'correct-horse-battery', anthropicKey: 'sk-ant-visitor-00000000000' }, env)
  assert.equal(r.source, 'owner')
}

// Wrong token fails loudly, never falls back.
assert.throws(() => resolveClaudeKey({ ownerToken: 'wrong' }, env), new RegExp(OWNER_TOKEN_INVALID))
assert.throws(() => resolveClaudeKey({ ownerToken: 'wrong', anthropicKey: 'sk-ant-visitor-00000000000' }, env), new RegExp(OWNER_TOKEN_INVALID))

// Unconfigured deployment: ownerToken is rejected, BYOK still works.
assert.throws(() => resolveClaudeKey({ ownerToken: 'anything' }, {} as any), /OWNER_MODE_NOT_CONFIGURED/)
{
  const r = resolveClaudeKey({ anthropicKey: 'sk-ant-visitor-00000000000' }, {} as any)
  assert.equal(r.source, 'byok')
}

// No credentials presented: no key.
assert.deepEqual(resolveClaudeKey({}, env), { key: null, source: null })

// Token shape abuse: non-string and oversized tokens never match.
for (const bad of [123, {}, [], 'x'.repeat(300)]) {
  assert.equal(ownerTokenMatches(bad, env), false)
}

// Similar-but-wrong tokens (prefix games, length games) never match.
for (const bad of ['correct-horse-batter', 'correct-horse-battery ', 'Correct-horse-battery']) {
  assert.equal(ownerTokenMatches(bad, env), false)
}

console.log('owner key resolution: all tests passed')

// Weak tokens never arm owner mode, even with a server key present.
assert.equal(
  ownerModeConfigured({ ANTHROPIC_API_KEY: 'sk-ant-server-key-000000000', RAG_OWNER_TOKEN: 'short' } as any),
  false
)
assert.throws(
  () => resolveClaudeKey({ ownerToken: 'short' }, { ANTHROPIC_API_KEY: 'sk-ant-server-key-000000000', RAG_OWNER_TOKEN: 'short' } as any),
  /OWNER_MODE_NOT_CONFIGURED/
)
