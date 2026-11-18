import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionStore } from '@/lib/store/sessionStore'
import { assertBrainAccess, BRAIN_SESSION_ID, BRAIN_FORBIDDEN } from '@/lib/brain'

/**
 * Owner-only: the second brain's saved conversation history (newest 200),
 * so a new tab, device or session shows what was said before.
 * GET /api/brain with header x-owner-token.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    assertBrainAccess(req, BRAIN_SESSION_ID)
  } catch (err: any) {
    if (err?.message === BRAIN_FORBIDDEN) {
      await new Promise((r) => setTimeout(r, 600))
      return res.status(403).json({ error: 'Owner passphrase required' })
    }
    throw err
  }
  try {
    const store = await getSessionStore()
    const messages = await store.listMessages(BRAIN_SESSION_ID, 200)
    return res.status(200).json({ messages })
  } catch (err: any) {
    console.error('brain history error', err?.message ?? err)
    return res.status(500).json({ error: 'Could not load history' })
  }
}
