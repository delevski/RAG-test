import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionStore } from '@/lib/store/sessionStore'
import { BRAIN_SESSION_ID, guardBrain, selectNotes, formatNotes, BRAIN_MEMORY_NOTICE } from '@/lib/brain'
import { summarizeEvents } from '@/lib/events'
import { runEval, labDemoOpen, DEMO_NOTES } from '@/lib/evalCases'
import { RAG_MOCK_ENABLED } from '@/lib/ai/mock'

/**
 * Owner-only learning lab. GET: request metrics + offline eval.
 * POST {question}: shows what WOULD be sent to Claude, step by step, without
 * calling any AI (zero cost). Header auth only.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const demo = labDemoOpen()
  if (!demo && !(await guardBrain(req, res))) return
  try {
    const store = await getSessionStore()
    if (req.method === 'GET') {
      const events = await store.listEvents(BRAIN_SESSION_ID, 500)
      return res.status(200).json({
        demo,
        driver: store.driver,
        mockMode: RAG_MOCK_ENABLED,
        metrics: summarizeEvents(events),
        recent: events.slice(-15).reverse(),
        eval: runEval(),
      })
    }
    if (req.method === 'POST') {
      const q = String((req.body as any)?.question ?? '').slice(0, 500)
      if (!q.trim()) return res.status(400).json({ error: 'Missing question' })
      const all = demo ? DEMO_NOTES : await store.listNotes(BRAIN_SESSION_ID)
      const chosen = selectNotes(all, q)
      return res.status(200).json({
        totalNotes: all.length,
        selected: chosen.map((n) => ({ date: n.ts.slice(0, 10), text: n.text })),
        omitted: all.length - chosen.length,
        notesBlock: BRAIN_MEMORY_NOTICE + '\n' + formatNotes(chosen, all.length - chosen.length),
        aiCalled: false,
      })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('brain lab error', err?.message ?? err)
    return res.status(500).json({ error: 'Storage error' })
  }
}
