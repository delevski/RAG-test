// Offline eval of note selection (synthetic, no AI). Run: npx tsx --test tests/eval.test.mts
import assert from 'node:assert/strict'
import { runEval } from '../lib/evalCases'
import { summarizeEvents } from '../lib/events'
const r = runEval()
for (const c of r) assert.ok(c.pass, `${c.id} failed: ${c.detail}`)
assert.ok(r.length >= 8)
const s = summarizeEvents([
  { ts: 'a', provider: 'mock', ok: true, ms: 10, notesTotal: 3, notesSent: 3, notesOmitted: 0, historyTurns: 1, questionChars: 5, answerChars: 9 },
  { ts: 'b', provider: 'claude', ok: false, ms: 90, notesTotal: 9, notesSent: 4, notesOmitted: 5, historyTurns: 2, questionChars: 7, answerChars: 0, error: 'X' },
])
assert.equal(s.requests, 2); assert.equal(s.failed, 1); assert.equal(s.requestsWithOmittedNotes, 1)
assert.ok(!JSON.stringify(s).includes('question'), 'summary has no text fields')
