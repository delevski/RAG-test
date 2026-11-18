/**
 * Offline eval of the part of the second brain that is OURS: which saved notes
 * reach Claude for a given question. Synthetic data only, zero AI calls, zero
 * cost. What Claude then SAYS is not tested here (that needs a paid call).
 */
import { selectNotes, formatNotes, BRAIN_MEMORY_NOTICE } from '@/lib/brain'

type N = { id: string; text: string; ts: string }
export type EvalResult = { id: string; title: string; why: string; pass: boolean; detail: string }

const mk = (i: number, text: string, day: number): N => ({
  id: String(i),
  text,
  ts: new Date(Date.UTC(2026, 0, day)).toISOString(),
})
const ctx = (notes: N[], q: string) => {
  const chosen = selectNotes(notes, q)
  return { chosen, text: formatNotes(chosen, notes.length - chosen.length) }
}

export function runEval(): EvalResult[] {
  const out: EvalResult[] = []
  const add = (id: string, title: string, why: string, pass: boolean, detail: string) =>
    out.push({ id, title, why, pass, detail })

  {
    const n = [mk(1, 'Remember this: the locker code for test fixture ZQ417 is blue-heron-88.', 1)]
    const { text } = ctx(n, "what's the combination of the ZQ417 locker?")
    add('en-paraphrase', 'ניסוח מחדש באנגלית', 'שאלה בניסוח אחר עדיין מביאה את העובדה השמורה אל Claude.',
      text.includes('blue-heron-88'), text)
  }
  {
    const n = [mk(1, 'הקוד של הלוקר בפיקסצ׳ר ZQ417 הוא blue-heron-88', 1)]
    const { text } = ctx(n, 'מה הקוד של הלוקר ב-ZQ417?')
    add('he-question', 'זיכרון ושאלה בעברית', 'עובדות בעברית נשמרות ומוצגות גם הן.',
      text.includes('blue-heron-88'), text)
  }
  {
    const n = [mk(1, 'The locker code for ZQ417 is blue-heron-88.', 1), mk(2, 'Update: the locker code for ZQ417 is now green-fox-19.', 5)]
    const { text } = ctx(n, 'what is the ZQ417 code?')
    const i1 = text.indexOf('blue-heron-88')
    const i2 = text.indexOf('green-fox-19')
    add('update-order', 'עדכון סותר', 'שני הזיכרונות מוצגים עם תאריך, הישן קודם, כך שהחדש גובר.',
      i1 >= 0 && i2 > i1, text)
  }
  {
    const filler = Array.from({ length: 250 }, (_, i) => mk(i + 2, `Filler note ${i}: ${'lorem ipsum dolor sit amet '.repeat(12)}`, 2 + (i % 20)))
    const old = mk(1, 'My dentist is Dr. Levi and the appointment is on March 3.', 1)
    const { text } = ctx([old, ...filler], 'when is my dentist appointment?')
    add('overflow-recall', 'זיכרון ישן מעבר לתקציב', 'מוח גדול עדיין שולף זיכרון ישן שחולק מילים עם השאלה.',
      text.includes('Dr. Levi'), text.split('\n').slice(0, 2).join(' | '))
    add('overflow-notice', 'זיכרונות שהושמטו מוכרזים', 'כשזיכרונות מושמטים, Claude מקבל על כך הודעה במקום לנחש.',
      /older saved notes are not shown/.test(text), text.split('\n')[0])
  }
  {
    const notes = [mk(1, 'My cat is called Pixel.', 1), mk(2, 'The locker code for ZQ417 is blue-heron-88.', 2)]
    const kept = notes.filter((x) => x.id !== '2')
    const { text } = ctx(kept, 'what is the ZQ417 code?')
    add('forget', 'זיכרון שנמחק נעלם', 'אחרי מחיקת זיכרון הוא כבר לא נשלח ל-Claude.',
      !text.includes('blue-heron-88'), text)
  }
  {
    const { text } = ctx([], 'anything?')
    add('empty', 'מוח ריק', 'אין זיכרונות אומר אין זיכרון מומצא.', text === '(none)', text)
  }
  add('notice', 'הודעת זיכרון אמיתית', 'Claude מקבל הודעה שהזיכרון פעיל, סלקטיבי ולא מובטח.',
    /selection/.test(BRAIN_MEMORY_NOTICE) && /not among them/.test(BRAIN_MEMORY_NOTICE), BRAIN_MEMORY_NOTICE.slice(0, 80))
  return out
}

/** Synthetic sample notes for the standalone demo trace (never the owner's notes). */
export const DEMO_NOTES: N[] = [
  mk(1, 'My cat is called Pixel.', 1),
  mk(2, 'The locker code for ZQ417 is blue-heron-88.', 2),
  mk(3, 'Update: the locker code for ZQ417 is now green-fox-19.', 6),
  mk(4, 'הקוד של הלוקר בפיקסצ׳ר ZQ417 הוא blue-heron-88', 3),
]

/**
 * Open (no passphrase) lab ONLY on a deployment that is explicitly mock-only,
 * file-store-only and flagged for it. Production lacks the flag, so it stays locked.
 */
export function labDemoOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RAG_LAB_DEMO_OPEN === '1' && env.RAG_MOCK === '1' && env.RAG_FORCE_FILE_STORE === '1'
}
