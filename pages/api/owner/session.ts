import type { NextApiRequest, NextApiResponse } from 'next'
import { ownerModeConfigured, ownerTokenMatches } from '@/lib/ai/ownerKey'
import { OWNER_SESSION_DAYS, cookieHeader, makeOwnerCookieValue, sessionCookieFromRequest } from '@/lib/ownerSession'

/** GET: is this browser a remembered owner? POST {token}: verify and remember. DELETE: log out. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') return res.status(200).json({ active: sessionCookieFromRequest(req) })
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieHeader('', 0))
    return res.status(200).json({ active: false })
  }
  if (req.method === 'POST') {
    const token = (req.body as any)?.token
    if (!ownerModeConfigured() || !ownerTokenMatches(token)) {
      await new Promise((r) => setTimeout(r, 600))
      return res.status(403).json({ error: 'Invalid owner token' })
    }
    res.setHeader('Set-Cookie', cookieHeader(makeOwnerCookieValue(), OWNER_SESSION_DAYS * 86400))
    return res.status(200).json({ active: true })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
