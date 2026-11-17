// BYOK validation tests. No network calls, no paid AI.
import assert from 'node:assert/strict'
import { validateAnthropicKey } from '../lib/ai/byok'

// Absent/empty keys pass through as "no BYOK".
assert.equal(validateAnthropicKey(undefined), null)
assert.equal(validateAnthropicKey(null), null)
assert.equal(validateAnthropicKey(''), null)

// Well-formed keys are accepted.
const good = 'sk-ant-api03-' + 'a'.repeat(40)
assert.equal(validateAnthropicKey(good), good)

// Malformed keys are rejected.
for (const bad of ['sk-openai-123', 'sk-ant-', 123, {}, 'sk-ant-' + 'x'.repeat(600)]) {
  assert.throws(() => validateAnthropicKey(bad), /INVALID_ANTHROPIC_KEY/, String(bad))
}
console.log('byok validation: all tests passed')
