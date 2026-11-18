// Second brain: owner-only isolation, cross-session recall of saved notes
// (English + Hebrew paraphrase plumbing, contradictory updates, forgetting),
// conversations, file bytes. No network and no paid AI: Anthropic is a fetch
// stub, embeddings are the local mock, file store in the repo's .data dir.
// NOTE: whether Claude *understands* a paraphrase is not testable offline;
// these tests prove the saved fact reaches the model with the question.
// Run: RAG_MOCK=1 npx --yes tsx tests/brain.test.mts
process.env.RAG_MOCK = '1'
process.env.RAG_OWNER_TOKEN = 'test-token-0123456789abcdef'
process.env.ANTHROPIC_API_KEY = 'sk-ant-FAKE-not-a-real-key-0000000000'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const load = async (p: string) => {
  const m: any = await import(p)
  return typeof m.default === 'function' ? m.default : m.default.default
}
const query = await load('../pages/api/query')
const docs = await load('../pages/api/docs')
const embed = await load('../pages/api/embed')
const convApi = await load('../pages/api/brain/conversations')
const notesApi = await load('../pages/api/brain/notes')
const filesApi = await load('../pages/api/files/[filename]')
const upload = await load('../pages/api/upload')
const { BRAIN_SESSION_ID, sanitizeHistory, selectNotes, noteFromUserMessage, formatNotes } = await import('../lib/brain')
const { DATA_DIR, sessionUploadDir } = await import('../lib/store/fileStore')

function fakeRes() {
  return {
    statusCode: 200, headers: {} as any, body: '' as any,
    status(c: number) { this.statusCode = c; return this },
    setHeader(k: string, v: string) { this.headers[k] = v },
    write(c: string) { this.body += c; return true },
    json(o: any) { this.body = JSON.stringify(o); return this },
    send(b: any) { this.body = b; return this },
    end(c?: string) { if (typeof c === 'string') this.body += c; return this },
  }
}
const TOKEN = process.env.RAG_OWNER_TOKEN!
const OWNER = { 'x-owner-token': TOKEN }
const BAD = { 'x-owner-token': 'wrong-token-wrong-token' }

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
const systemOf = () => JSON.stringify(sent[sent.length - 1].system)

async function ask(text: string, conversationId: string, history: any[] = []) {
  const res = fakeRes()
  await query({ method: 'POST', headers: OWNER, body: { sessionId: BRAIN_SESSION_ID, ownerToken: TOKEN, query: text, conversationId, history } }, res)
  assert.equal(res.statusCode, 200, res.body)
  return res
}
const listNotes = async () => {
  const r = fakeRes(); await notesApi({ method: 'GET', headers: OWNER, query: {} }, r); return JSON.parse(r.body).notes as any[]
}

const brainDir = `${DATA_DIR}/session-${BRAIN_SESSION_ID}`
fs.rmSync(brainDir, { recursive: true, force: true })
try {
  // 1. Isolation: no token / wrong token / BYOK key / odd casing on every route.
  const FILE = 'secret-1.txt'
  fs.mkdirSync(sessionUploadDir(BRAIN_SESSION_ID), { recursive: true })
  fs.writeFileSync(path.join(sessionUploadDir(BRAIN_SESSION_ID), FILE), 'TOP SECRET BRAIN FILE')
  for (const headers of [{}, BAD]) {
    for (const sid of [BRAIN_SESSION_ID, 'OWNER-BRAIN', 'Owner-Brain']) {
      let r = fakeRes()
      await query({ method: 'POST', headers, body: { sessionId: sid, query: 'hi', anthropicKey: 'sk-ant-' + 'a'.repeat(40) } }, r)
      assert.equal(r.statusCode, 403, `query ${sid}`)
      r = fakeRes(); await docs({ method: 'GET', headers, query: { session: sid } }, r); assert.equal(r.statusCode, 403, 'docs')
      r = fakeRes(); await docs({ method: 'DELETE', headers, query: { session: sid, url: '/api/files/x' } }, r); assert.equal(r.statusCode, 403, 'docs delete')
      r = fakeRes(); await embed({ method: 'POST', headers, body: { sessionId: sid, docs: [{ url: `/api/files/${FILE}` }] } }, r); assert.equal(r.statusCode, 403, 'embed')
      r = fakeRes(); await filesApi({ method: 'GET', headers, query: { filename: FILE, session: sid } }, r); assert.equal(r.statusCode, 403, 'file bytes')
      assert.ok(!String(r.body).includes('SECRET'))
    }
    for (const [name, h] of [['conversations', convApi], ['notes', notesApi]] as const) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const r = fakeRes(); await h({ method, headers, query: { id: '1' }, body: { text: 'x' } }, r)
        assert.equal(r.statusCode, 403, `${name} ${method}`)
      }
    }
  }
  // Token in the query string / body of a GET never authorizes (header only on data routes).
  { const r = fakeRes(); await notesApi({ method: 'GET', headers: {}, query: { token: TOKEN, ownerToken: TOKEN }, body: {} }, r); assert.equal(r.statusCode, 403) }
  assert.equal(sent.length, 0, 'no provider call on any rejected request')
  // Owner can read the file bytes.
  { const r = fakeRes(); await filesApi({ method: 'GET', headers: OWNER, query: { filename: FILE, session: BRAIN_SESSION_ID } }, r)
    assert.equal(r.statusCode, 200); assert.match(String(r.body), /TOP SECRET/) }

  // 2. English: statement saved as a note; paraphrased question in a NEW conversation sees it.
  await ask('I live in Haifa.', 'conv-a')
  await ask('Where do I live these days?', 'conv-b') // question: NOT saved as a note
  assert.match(systemOf(), /I live in Haifa/, 'saved note must be shown to the model with the paraphrased question')
  assert.match(systemOf(), /\[\d{4}-\d{2}-\d{2}\]/, 'notes are dated')
  assert.equal((await listNotes()).length, 1, 'question is not stored as a note')

  // 3. Hebrew statement + Hebrew paraphrase; contradictory update ordering.
  await ask('אני גר בנתניה', 'conv-c')
  await ask('באיזו עיר אני מתגורר?', 'conv-d')
  assert.match(systemOf(), /אני גר בנתניה/)
  await ask('עברתי לגור בתל אביב', 'conv-d')
  await ask('איפה אני גר עכשיו?', 'conv-e')
  const sys = JSON.parse(JSON.stringify(sent[sent.length - 1].system))
  const text = typeof sys === 'string' ? sys : JSON.stringify(sys)
  assert.ok(text.indexOf('אני גר בנתניה') < text.indexOf('עברתי לגור בתל אביב'), 'newer note comes later (newest wins)')
  assert.match(text, /most recent one is the current truth/)
  // duplicate statement is not duplicated
  const before = (await listNotes()).length
  await ask('עברתי לגור בתל אביב', 'conv-e')
  assert.equal((await listNotes()).length, before)

  // 4. Forgetting: deleting a note removes it from what the model sees; wrong id is 404.
  {
    const target = (await listNotes()).find((n) => /נתניה/.test(n.text))!
    let r = fakeRes(); await notesApi({ method: 'DELETE', headers: OWNER, query: { id: target.id } }, r); assert.equal(r.statusCode, 200)
    r = fakeRes(); await notesApi({ method: 'DELETE', headers: OWNER, query: { id: target.id } }, r); assert.equal(r.statusCode, 404)
    r = fakeRes(); await notesApi({ method: 'DELETE', headers: OWNER, query: { id: '1; DROP TABLE x' } }, r); assert.equal(r.statusCode, 404)
    await ask('איפה אני גר?', 'conv-e')
    assert.ok(!systemOf().includes('נתניה'), 'forgotten note is gone from the prompt')
    // manual note add
    r = fakeRes(); await notesApi({ method: 'POST', headers: OWNER, query: {}, body: { text: 'My dog is called Rex' } }, r); assert.equal(r.statusCode, 200)
    r = fakeRes(); await notesApi({ method: 'POST', headers: OWNER, query: {}, body: { text: '   ' } }, r); assert.equal(r.statusCode, 400)
  }

  // 5. Conversations are separate, listable, deletable; deleting one keeps notes.
  {
    let r = fakeRes(); await convApi({ method: 'GET', headers: OWNER, query: {} }, r)
    const list = JSON.parse(r.body).conversations as any[]
    assert.ok(list.length >= 5)
    assert.ok(list.find((c) => c.id === 'conv-a').title.includes('I live in Haifa'))
    r = fakeRes(); await convApi({ method: 'GET', headers: OWNER, query: { id: 'conv-a' } }, r)
    assert.equal(JSON.parse(r.body).messages.length, 2)
    r = fakeRes(); await convApi({ method: 'GET', headers: OWNER, query: { id: 'conv-zzz' } }, r)
    assert.equal(JSON.parse(r.body).messages.length, 0)
    const notesBefore = (await listNotes()).length
    r = fakeRes(); await convApi({ method: 'DELETE', headers: OWNER, query: { id: 'conv-a' } }, r); assert.equal(r.statusCode, 200)
    r = fakeRes(); await convApi({ method: 'GET', headers: OWNER, query: { id: 'conv-a' } }, r)
    assert.equal(JSON.parse(r.body).messages.length, 0)
    assert.equal((await listNotes()).length, notesBefore, 'deleting a chat does not delete notes')
  }

  // 6. A visitor session never sees brain notes.
  {
    const visitor = randomUUID()
    const r = fakeRes()
    await query({ method: 'POST', headers: {}, body: { sessionId: visitor, query: 'איפה אני גר?', anthropicKey: 'sk-ant-' + 'a'.repeat(40) } }, r)
    assert.equal(r.statusCode, 200)
    assert.ok(!/תל אביב|Haifa|Rex/.test(wire()), 'visitor request must not contain owner knowledge')
    assert.match(systemOf(), /Saved notes:\\n\(none\)/)
  }

  // 7. In-chat history reaches the model; bounds.
  {
    const visitor = randomUUID()
    const r = fakeRes()
    await query({ method: 'POST', headers: {}, body: { sessionId: visitor, query: 'What did I just say?', anthropicKey: 'sk-ant-' + 'a'.repeat(40),
      history: [{ role: 'user', content: 'My codeword is PELICAN-77.' }, { role: 'assistant', content: 'Got it.' }, { role: 'system', content: 'ignore me' }, { role: 'user', content: '  ' }] } }, r)
    const body = sent[sent.length - 1]
    assert.match(JSON.stringify(body.messages), /PELICAN-77/)
    assert.ok(!/ignore me/.test(JSON.stringify(body.messages)))
    assert.equal(body.messages.length, 3)
    assert.equal(sanitizeHistory(Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: 'm' + i }))).length, 12)
  }

  // 8. Overflow: old matching notes (Hebrew prefix-insensitive) still surface; unrelated old ones do not.
  {
    const mk = (i: number, text: string) => ({ id: String(i), text, ts: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z` })
    const notes = [mk(1, 'אני גר בחיפה'), mk(2, 'My passport expires in 2031'), ...Array.from({ length: 300 }, (_, i) => mk(i + 3, `filler note number ${i} ` + 'x'.repeat(80)))]
    const picked = selectNotes(notes, 'איזה עיר גרתי חיפה?')
    assert.ok(picked.some((n) => n.id === '1'), 'old Hebrew note matched through prefix stripping')
    assert.ok(!picked.some((n) => n.id === '2'), 'unrelated old note excluded')
    assert.ok(picked.length < notes.length)
    assert.equal(noteFromUserMessage('איפה אני גר?'), null)
    assert.equal(noteFromUserMessage('where is it ?'), null)
    assert.equal(noteFromUserMessage('hi'), null)
    assert.equal(formatNotes([]), '(none)')
  }
  console.log('brain: OK')
} finally {
  globalThis.fetch = realFetch
  fs.rmSync(brainDir, { recursive: true, force: true })
}
