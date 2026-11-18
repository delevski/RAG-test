import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionStore } from '@/lib/store/sessionStore'
import { BRAIN_SESSION_ID, guardBrain, sanitizeConversationId } from '@/lib/brain'

/**
 * Owner-only saved conversations. Auth is the x-owner-token header only: the
 * passphrase never appears in a URL. GET lists conversations, GET ?id= reads
 * one, DELETE ?id= removes one conversation's messages (notes and documents
 * are separate and untouched).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await guardBrain(req, res))) return
  try {
    const store = await getSessionStore()
    const id = typeof req.query.id === 'string' ? req.query.id : undefined
    if (req.method === 'GET') {
      if (id === undefined) {
        return res.status(200).json({ conversations: await store.listConversations(BRAIN_SESSION_ID) })
      }
      return res
        .status(200)
        .json({ messages: await store.listMessages(BRAIN_SESSION_ID, sanitizeConversationId(id), 200) })
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Missing id' })
      await store.deleteConversation(BRAIN_SESSION_ID, sanitizeConversationId(id))
      return res.status(200).json({ ok: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('brain conversations error', err?.message ?? err)
    return res.status(500).json({ error: 'Storage error' })
  }
}
