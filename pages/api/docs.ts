import type { NextApiRequest, NextApiResponse } from 'next'
import { assertValidSessionId, listSessionDocs, removeSessionDoc } from '@/lib/langchain/retriever'

/**
 * Session-scoped document listing. Lets the client restore its document
 * list after a page refresh: the session id survives in localStorage and
 * this endpoint returns whatever the store still holds for it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { session, url } = req.query
  try {
    assertValidSessionId(session)
  } catch {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }
  try {
    if (req.method === 'DELETE') {
      if (typeof url !== 'string' || !url.startsWith('/api/files/')) {
        return res.status(400).json({ error: 'Invalid document url' })
      }
      await removeSessionDoc(session as string, url)
      return res.status(200).json({ ok: true })
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const result = await listSessionDocs(session as string)
    return res.status(200).json(result)
  } catch (err: any) {
    console.error('docs error', err)
    return res.status(500).json({ error: err?.message ?? 'Internal error' })
  }
}
