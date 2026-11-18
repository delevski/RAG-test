/**
 * Request observability for the owner's second brain.
 * Privacy rule: an event holds COUNTS and TIMINGS only. Never the question,
 * the answer, or any note text. That is what lets the dashboard stay inside
 * this app, with no external logging service.
 */
export type RagEvent = {
  ts: string
  /** 'mock' = simulated answer (RAG_MOCK, free), 'claude' = real paid answer. */
  provider: 'mock' | 'claude'
  ok: boolean
  ms: number
  notesTotal: number
  notesSent: number
  notesOmitted: number
  historyTurns: number
  questionChars: number
  answerChars: number
  /** Provider-reported tokens. null = the provider did not report them (unknown, NOT zero). */
  tokensIn?: number | null
  tokensOut?: number | null
  error?: string
}

export const MAX_EVENTS = 500

export function summarizeEvents(events: RagEvent[]) {
  const n = events.length
  const byProvider = (p: RagEvent['provider']) => events.filter((e) => e.provider === p)
  const ms = events.map((e) => e.ms).sort((a, b) => a - b)
  const pct = (q: number) => (n === 0 ? 0 : ms[Math.min(n - 1, Math.floor(q * n))])
  const sum = (f: (e: RagEvent) => number) => events.reduce((s, e) => s + f(e), 0)
  return {
    requests: n,
    failed: events.filter((e) => !e.ok).length,
    mockRequests: byProvider('mock').length,
    claudeRequests: byProvider('claude').length,
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    avgNotesSent: n === 0 ? 0 : Math.round((sum((e) => e.notesSent) / n) * 10) / 10,
    requestsWithOmittedNotes: events.filter((e) => e.notesOmitted > 0).length,
    /** Requests where the provider reported usage; the rest are unknown, never counted as 0. */
    tokenKnownRequests: events.filter((e) => typeof e.tokensIn === 'number').length,
    tokensIn: sum((e) => (typeof e.tokensIn === 'number' ? e.tokensIn : 0)),
    tokensOut: sum((e) => (typeof e.tokensOut === 'number' ? e.tokensOut : 0)),
    totalQuestionChars: sum((e) => e.questionChars),
    totalAnswerChars: sum((e) => e.answerChars),
  }
}
