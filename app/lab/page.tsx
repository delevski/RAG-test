'use client'
import { useEffect, useState } from 'react'

type Eval = { id: string; title: string; why: string; pass: boolean; detail: string }
type Lab = { demo?: boolean; driver: string; mockMode: boolean; metrics: Record<string, number>; recent: any[]; eval: Eval[] }
type Trace = { totalNotes: number; selected: { date: string; text: string }[]; omitted: number; notesBlock: string }

const card = 'rounded-xl border border-white/10 bg-white/[0.03] p-4'

export default function LabPage() {
  const [token, setToken] = useState('')
  const [lab, setLab] = useState<Lab | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [question, setQuestion] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/brain/lab').then(async (r) => { if (r.ok) setLab(await r.json()) }).catch(() => {})
  }, [])

  async function load() {
    setErr('')
    const r = await fetch('/api/brain/lab', { headers: { 'x-owner-token': token } })
    if (!r.ok) return setErr('נדרשת סיסמת בעלים')
    setLab(await r.json())
  }
  async function ask() {
    setErr('')
    const r = await fetch('/api/brain/lab', {
      method: 'POST',
      headers: { 'x-owner-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    if (!r.ok) return setErr('לא ניתן לעקוב אחרי השאלה')
    setTrace(await r.json())
  }
  const m = lab?.metrics
  const passed = lab?.eval.filter((e) => e.pass).length ?? 0

  return (
    <main dir="rtl" lang="he" className="mx-auto max-w-4xl space-y-6 p-6 text-sm text-slate-200">
      <h1 className="text-2xl font-semibold text-white">מעבדת המוח השני</h1>
      <p className="text-slate-400">
        כאן רואים איך שאלה עוברת במוח: אילו זיכרונות נשלפים, מה נמדד בכל בקשה, והאם שלב השליפה נכון.
        שום דבר כאן לא קורא למודל AI, ולכן זה בחינם. הסיסמה נשארת רק בלשונית הזו.
      </p>

      {lab?.demo && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-amber-200">
          דמו עצמאי: נתונים סינתטיים ומדומים בלבד (MOCK), בלי Claude ובלי המוח האמיתי של אורי. האחסון בקובץ זמני בשרת ועלול להיעלם בכל רגע.
        </p>
      )}

      {!lab && (
        <div className={card + ' flex gap-2'}>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="סיסמת בעלים" dir="ltr"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
          <button onClick={load} className="rounded-lg bg-indigo-500 px-4 py-2 text-white">פתח מעבדה</button>
        </div>
      )}
      {err && <p className="text-red-400">{err}</p>}

      {lab && (
        <>
          <section className={card}>
            <h2 className="mb-2 text-lg font-medium text-white">1. עוקבים אחרי שאלה (בלי קריאת AI)</h2>
            <div className="flex gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="שאל משהו שהמוח אולי יודע"
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
              <button onClick={ask} className="rounded-lg bg-indigo-500 px-4 py-2 text-white">עקוב</button>
            </div>
            {trace && (
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li><b>שאלה</b>: {question}</li>
                <li><b>שליפה</b>: נבחרו {trace.selected.length} מתוך {trace.totalNotes} זיכרונות שמורים
                  {trace.omitted > 0 && `, ${trace.omitted} הושמטו (Claude מקבל על כך הודעה)`}.</li>
                <li><b>מה Claude היה רואה</b> (בלוק הזיכרונות):
                  <pre dir="ltr" className="mt-1 whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-xs text-left">{trace.notesBlock}</pre></li>
                <li><b>תשובה</b>: לא נוצרת כאן. תשובה אמיתית היא קריאה בתשלום ל-Claude, רק מהצ&apos;אט.
                  אחר כך היא מופיעה למטה כשורת מדדים (ספירות וזמנים בלבד).</li>
              </ol>
            )}
          </section>

          <section className={card}>
            <h2 className="mb-2 text-lg font-medium text-white">2. מדדי בקשות (אמיתיות ו-MOCK מסומנות בנפרד)</h2>
            <p className="mb-2 text-xs text-slate-400">
              ספירות וזמנים בלבד, אף פעם לא טקסט של שאלות, תשובות או זיכרונות. אחסון: {lab.driver}.
              {lab.mockMode ? ' הפריסה הזו במצב MOCK: התשובות מדומות ולא עולות כסף.' : ''}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['בקשות', m?.requests], ['נכשלו', m?.failed], ['Claude אמיתי', m?.claudeRequests], ['MOCK (מדומה)', m?.mockRequests],
                ['חציון ms', m?.p50Ms], ['p95 ms', m?.p95Ms], ['ממוצע זיכרונות שנשלחו', m?.avgNotesSent], ['עם זיכרונות שהושמטו', m?.requestsWithOmittedNotes],
                ['בקשות עם דיווח טוקנים', m?.tokenKnownRequests], ['טוקני קלט / פלט', m && m.tokenKnownRequests > 0 ? `${m.tokensIn} / ${m.tokensOut}` : 'לא ידוע'],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-black/30 p-3"><div className="text-xs text-slate-400">{k}</div><div className="text-xl text-white">{String(v ?? 0)}</div></div>
              ))}
            </div>
            {lab.recent.length > 0 && (
              <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] whitespace-nowrap text-right text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1">
                <thead className="text-slate-400"><tr><th>שעה</th><th>ספק</th><th>ms</th><th>זיכרונות נשלחו/סך הכל</th><th>טוקנים</th><th>תקין</th></tr></thead>
                <tbody>{lab.recent.map((e, i) => (
                  <tr key={i} className="border-t border-white/5"><td>{String(e.ts).slice(11, 19)}</td><td>{e.provider}</td><td>{e.ms}</td><td>{e.notesSent}/{e.notesTotal}</td><td>{typeof e.tokensIn === 'number' ? `${e.tokensIn}/${e.tokensOut}` : 'לא ידוע'}</td><td>{e.ok ? 'כן' : e.error || 'לא'}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            {lab.recent.length === 0 && <p className="mt-2 text-slate-400">עדיין אין בקשות. שוחח במצב בעלים והן יופיעו כאן. טוקנים מוצגים רק כשהספק מדווח עליהם; אחרת &quot;לא ידוע&quot;, לא 0, וללא מחיר מומצא.</p>}
          </section>

          <section className={card}>
            <h2 className="mb-1 text-lg font-medium text-white">3. בדיקת איכות לשליפה בלבד ({passed}/{lab.eval.length} עברו)</h2>
            <p className="mb-2 text-xs text-slate-400">
              זיכרונות סינתטיים, רצים חי בשרת, בלי AI. זה בודק אילו זיכרונות מגיעים ל-Claude, לא מה Claude עונה.
              בדיקת איכות התשובות דורשת קריאות בתשלום ורצה ידנית עם תקרה.
            </p>
            <ul className="space-y-2">
              {lab.eval.map((e) => (
                <li key={e.id} className="rounded-lg bg-black/30 p-3">
                  <div><span className={e.pass ? 'text-emerald-400' : 'text-red-400'}>{e.pass ? 'עבר' : 'נכשל'}</span> <b>{e.title}</b></div>
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
