import type { NextApiRequest, NextApiResponse } from 'next'
import { indexDocuments } from '@/lib/langchain/retriever'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ 
        error: 'OPENAI_API_KEY is missing',
        message: 'Please add your OpenAI API key to .env.local file. Get your key from https://platform.openai.com/api-keys'
      })
    }

    const { sessionId, docs } = req.body as { sessionId: string; docs: Array<{ url: string; name?: string }> }
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' })
    if (!Array.isArray(docs) || docs.length === 0) return res.status(400).json({ error: 'No documents provided' })
    
    await indexDocuments(sessionId, docs)
    return res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('embed error', err)
    
    // Provide helpful error messages
    if (err?.message?.includes('OPENAI_API_KEY')) {
      return res.status(400).json({ 
        error: 'OpenAI API key is missing or invalid',
        message: 'Please add your OpenAI API key to .env.local file. Get your key from https://platform.openai.com/api-keys'
      })
    }
    
    return res.status(500).json({ error: err?.message ?? 'Internal error' })
  }
}

