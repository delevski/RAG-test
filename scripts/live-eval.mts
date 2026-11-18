// MANUAL, PAID reply-quality eval. Not run by CI or tests.
// Each case makes ONE real Claude call on the owner's key (billed to the owner).
// Safety: needs explicit opt-in + a hard cap; refuses otherwise.
//   RAG_LIVE_EVAL=yes BASE_URL=https://<your-preview> OWNER_TOKEN=... npx tsx scripts/live-eval.mts --max-calls 3
// Uses synthetic facts with a unique id and deletes what it created.
const args = process.argv.slice(2)
const capArg = args.indexOf('--max-calls')
const cap = capArg >= 0 ? Number(args[capArg + 1]) : 0
if (process.env.RAG_LIVE_EVAL !== 'yes' || !(cap >= 1 && cap <= 5)) {
  console.error('Refusing to run: set RAG_LIVE_EVAL=yes and pass --max-calls N (1-5). Each call is a paid Claude answer.')
  process.exit(2)
}
const base = process.env.BASE_URL
const token = process.env.OWNER_TOKEN
if (!base || !token) { console.error('BASE_URL and OWNER_TOKEN are required'); process.exit(2) }
const id = 'EV' + Math.random().toString(36).slice(2, 7).toUpperCase()
const cases = [
  { say: `Remember: the locker code for fixture ${id} is blue-heron-88.`, expect: /blue-heron-88/i, name: 'store (ack)', optional: true },
  { say: `what is the combination of locker ${id}?`, expect: /blue-heron-88/, name: 'EN paraphrase' },
  { say: `עדכון: הקוד של ${id} הוא עכשיו green-fox-19. מה הקוד?`, expect: /green-fox-19/, forbid: /^(?!.*green-fox-19).*blue-heron-88/s, name: 'HE update' },
]
const h = { 'content-type': 'application/json', 'x-owner-token': token }
let calls = 0
const results: string[] = []
for (const c of cases) {
  if (calls >= cap) break
  calls++
  const r = await fetch(`${base}/api/query`, { method: 'POST', headers: h, body: JSON.stringify({ sessionId: 'owner-brain', query: c.say, conversationId: 'live-eval-' + id, history: [] }) })
  const text = (await r.text()).split('__SOURCES__')[0]
  const ok = r.ok && c.expect.test(text)
  results.push(`${ok ? 'PASS' : 'FAIL'} ${c.name} (${text.length} chars)`)
}
// cleanup of exactly what this run created
const notes = (await (await fetch(`${base}/api/brain/notes`, { headers: h })).json()).notes ?? []
for (const n of notes) if (String(n.text).includes(id)) await fetch(`${base}/api/brain/notes?id=${n.id}`, { method: 'DELETE', headers: h })
await fetch(`${base}/api/brain/conversations?id=live-eval-${id}`, { method: 'DELETE', headers: h })
console.log(results.join('\n'), `\n${calls} paid call(s) made.`)
