import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionStore } from '@/lib/store/sessionStore'
import { BRAIN_SESSION_ID, guardBrain, MAX_NOTE_CHARS, MAX_NOTES } from '@/lib/brain'

/**
 * Owner-only memory notes: list, add, delete. Header auth only.
 * Deleting a note is permanent and is the way to retract a wrong fact.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await guardBrain(req, res))) return
  try {
    const store = await getSessionStore()
    if (req.method === 'GET') {
      return res.status(200).json({ notes: await store.listNotes(BRAIN_SESSION_ID) })
    }
    if (req.method === 'POST') {
      const text = (req.body as any)?.text
      if (typeof text !== 'string' || text.trim().length < 1) {
        return res.status(400).json({ error: 'Missing text' })
      }
      if ((await store.listNotes(BRAIN_SESSION_ID)).length >= MAX_NOTES) {
        return res.status(400).json({ error: 'Note limit reached' })
      }
      const note = await store.addNote(BRAIN_SESSION_ID, text.trim().slice(0, MAX_NOTE_CHARS))
      return res.status(200).json({ note })
    }
    if (req.method === 'DELETE') {
      const id = typeof req.query.id === 'string' ? req.query.id : ''
      const ok = await store.deleteNote(BRAIN_SESSION_ID, id)
      return res.status(ok ? 200 : 404).json({ ok })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('brain notes error', err?.message ?? err)
    return res.status(500).json({ error: 'Storage error' })
  }
}
