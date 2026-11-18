'use client'
import { useState } from 'react'

type Eval = { id: string; title: string; why: string; pass: boolean; detail: string }
type Lab = { driver: string; mockMode: boolean; metrics: Record<string, number>; recent: any[]; eval: Eval[] }
type Trace = { totalNotes: number; selected: { date: string; text: string }[]; omitted: number; notesBlock: string }

const card = 'rounded-xl border border-white/10 bg-white/[0.03] p-4'

export default function LabPage() {
  const [token, setToken] = useState('')
  const [lab, setLab] = useState<Lab | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    setErr('')
    const r = await fetch('/api/brain/lab', { headers: { 'x-owner-token': token } })
    if (!r.ok) return setErr('Owner passphrase required')
    setLab(await r.json())
  }
  async function ask() {
    setErr('')
    const r = await fetch('/api/brain/lab', {
      method: 'POST',
      headers: { 'x-owner-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    if (!r.ok) return setErr('Could not trace this question')
    setTrace(await r.json())
  }
  const m = lab?.metrics
  const passed = lab?.eval.filter((e) => e.pass).length ?? 0

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 text-sm text-slate-200">
      <h1 className="text-2xl font-semibold text-white">Second brain lab</h1>
      <p className="text-slate-400">
        See how one question moves through the brain, what is measured, and whether the retrieval step is correct.
        Nothing here calls an AI model, so it costs nothing. Your passphrase stays in this tab only.
      </p>

      {!lab && (
        <div className={card + ' flex gap-2'}>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Owner passphrase"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
          <button onClick={load} className="rounded-lg bg-indigo-500 px-4 py-2 text-white">Open lab</button>
        </div>
      )}
      {err && <p className="text-red-400">{err}</p>}

      {lab && (
        <>
          <section className={card}>
            <h2 className="mb-2 text-lg font-medium text-white">1. Follow a question (no AI call)</h2>
            <div className="flex gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask something your brain might know"
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
              <button onClick={ask} className="rounded-lg bg-indigo-500 px-4 py-2 text-white">Trace</button>
            </div>
            {trace && (
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li><b>Question</b>: {question}</li>
                <li><b>Retrieve</b>: {trace.selected.length} of {trace.totalNotes} saved notes chosen
                  {trace.omitted > 0 && `, ${trace.omitted} left out (Claude is told)`}.</li>
                <li><b>What Claude would see</b> (notes block):
                  <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-xs">{trace.notesBlock}</pre></li>
                <li><b>Answer</b>: not generated here. A real answer is a paid Claude call, made only from the chat.
                  It then appears below as a metrics row (counts and timing only).</li>
              </ol>
            )}
          </section>

          <section className={card}>
            <h2 className="mb-2 text-lg font-medium text-white">2. Metrics from real requests</h2>
            <p className="mb-2 text-xs text-slate-400">
              Counts and timings only, never the text of questions, answers or notes. Storage: {lab.driver}.
              {lab.mockMode ? ' This deployment is in MOCK mode: answers are simulated.' : ''}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Requests', m?.requests], ['Failed', m?.failed], ['Real Claude', m?.claudeRequests], ['Mock', m?.mockRequests],
                ['Median ms', m?.p50Ms], ['p95 ms', m?.p95Ms], ['Avg notes sent', m?.avgNotesSent], ['With omitted notes', m?.requestsWithOmittedNotes],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-black/30 p-3"><div className="text-xs text-slate-400">{k}</div><div className="text-xl text-white">{String(v ?? 0)}</div></div>
              ))}
            </div>
            {lab.recent.length > 0 && (
              <table className="mt-3 w-full text-left text-xs">
                <thead className="text-slate-400"><tr><th>Time</th><th>Provider</th><th>ms</th><th>Notes sent/total</th><th>OK</th></tr></thead>
                <tbody>{lab.recent.map((e, i) => (
                  <tr key={i} className="border-t border-white/5"><td>{String(e.ts).slice(11, 19)}</td><td>{e.provider}</td><td>{e.ms}</td><td>{e.notesSent}/{e.notesTotal}</td><td>{e.ok ? 'yes' : e.error || 'no'}</td></tr>
                ))}</tbody>
              </table>
            )}
            {lab.recent.length === 0 && <p className="mt-2 text-slate-400">No requests recorded yet. Chat in owner mode and they appear here.</p>}
          </section>

          <section className={card}>
            <h2 className="mb-1 text-lg font-medium text-white">3. Eval: is retrieval correct? ({passed}/{lab.eval.length} pass)</h2>
            <p className="mb-2 text-xs text-slate-400">
              Synthetic notes, run live on the server, no AI. This checks which notes reach Claude, not what Claude replies.
              Checking replies needs paid calls and is run by hand with a cap.
            </p>
            <ul className="space-y-2">
              {lab.eval.map((e) => (
                <li key={e.id} className="rounded-lg bg-black/30 p-3">
                  <div><span className={e.pass ? 'text-emerald-400' : 'text-red-400'}>{e.pass ? 'PASS' : 'FAIL'}</span> <b>{e.title}</b></div>
                  <div className="text-xs text-slate-400">{e.why}</div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
