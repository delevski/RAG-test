import type { NextApiRequest, NextApiResponse } from 'next'
import { runRagQuery } from '@/lib/langchain/ragChain'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed')
  const { sessionId, query } = req.body as { sessionId: string; query: string }
  if (!sessionId || !query) return res.status(400).end('Missing parameters')

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')

  try {
    await runRagQuery(sessionId, query, (token) => {
      res.write(token)
    })
    res.end()
  } catch (err: any) {
    console.error('query error', err)
    res.status(500).end(err?.message ?? 'Internal error')
  }
}

