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
    add('en-paraphrase', 'English paraphrase', 'A reworded question still gets the saved fact in front of Claude.',
      text.includes('blue-heron-88'), text)
  }
  {
    const n = [mk(1, 'הקוד של הלוקר בפיקסצ׳ר ZQ417 הוא blue-heron-88', 1)]
    const { text } = ctx(n, 'מה הקוד של הלוקר ב-ZQ417?')
    add('he-question', 'Hebrew note and question', 'Hebrew facts are kept and shown too.',
      text.includes('blue-heron-88'), text)
  }
  {
    const n = [mk(1, 'The locker code for ZQ417 is blue-heron-88.', 1), mk(2, 'Update: the locker code for ZQ417 is now green-fox-19.', 5)]
    const { text } = ctx(n, 'what is the ZQ417 code?')
    const i1 = text.indexOf('blue-heron-88')
    const i2 = text.indexOf('green-fox-19')
    add('update-order', 'Contradictory update', 'Both notes are shown, dated, oldest first, so the newest wins.',
      i1 >= 0 && i2 > i1, text)
  }
  {
    const filler = Array.from({ length: 250 }, (_, i) => mk(i + 2, `Filler note ${i}: ${'lorem ipsum dolor sit amet '.repeat(12)}`, 2 + (i % 20)))
    const old = mk(1, 'My dentist is Dr. Levi and the appointment is on March 3.', 1)
    const { text } = ctx([old, ...filler], 'when is my dentist appointment?')
    add('overflow-recall', 'Old note beyond the budget', 'A big brain still pulls an older note that shares words with the question.',
      text.includes('Dr. Levi'), text.split('\n').slice(0, 2).join(' | '))
    add('overflow-notice', 'Omitted notes are announced', 'When notes are left out, Claude is told so instead of guessing.',
      /older saved notes are not shown/.test(text), text.split('\n')[0])
  }
  {
    const notes = [mk(1, 'My cat is called Pixel.', 1), mk(2, 'The locker code for ZQ417 is blue-heron-88.', 2)]
    const kept = notes.filter((x) => x.id !== '2')
    const { text } = ctx(kept, 'what is the ZQ417 code?')
    add('forget', 'Deleted note is gone', 'After you delete a note, it is no longer sent to Claude.',
      !text.includes('blue-heron-88'), text)
  }
  {
    const { text } = ctx([], 'anything?')
    add('empty', 'Empty brain', 'No notes means no invented memory.', text === '(none)', text)
  }
  add('notice', 'Truthful memory notice', 'Claude is told memory is on, selective, and not guaranteed.',
    /selection/.test(BRAIN_MEMORY_NOTICE) && /not among them/.test(BRAIN_MEMORY_NOTICE), BRAIN_MEMORY_NOTICE.slice(0, 80))
  return out
}
