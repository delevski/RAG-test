import type { NextApiRequest, NextApiResponse } from 'next'
import {
  indexDocuments,
  assertValidSessionId,
  MAX_DOCS_PER_SESSION,
} from '@/lib/langchain/retriever'
import { RAG_MOCK_ENABLED, PAID_AI_DISABLED, paidAIAllowed } from '@/lib/ai/mock'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!RAG_MOCK_ENABLED) {
      if (!paidAIAllowed()) {
        return res.status(400).json({ error: 'Paid AI calls are disabled', message: PAID_AI_DISABLED })
      }
      if (!process.env.OPENAI_API_KEY) {
        return res.status(400).json({
          error: 'OPENAI_API_KEY is missing',
          message:
            'Please add your OpenAI API key to .env.local file. Get your key from https://platform.openai.com/api-keys',
        })
      }
    }

    const { sessionId, docs } = req.body as {
      sessionId: string
      docs: Array<{ url: string; name?: string; size?: number; type?: string }>
    }
    assertValidSessionId(sessionId)
    if (!Array.isArray(docs) || docs.length === 0) {
      return res.status(400).json({ error: 'No documents provided' })
    }
    if (docs.length > MAX_DOCS_PER_SESSION) {
      return res
        .status(400)
        .json({ error: `A session can hold at most ${MAX_DOCS_PER_SESSION} documents` })
    }
    for (const d of docs) {
      if (!d || typeof d.url !== 'string' || d.url.length === 0 || d.url.length > 2048) {
        return res.status(400).json({ error: 'Invalid document entry' })
      }
    }

    const result = await indexDocuments(sessionId, docs)
    return res.status(200).json({ ok: true, ...result })
  } catch (err: any) {
    console.error('embed error', err)

    if (err?.message === 'Invalid sessionId') {
      return res.status(400).json({ error: 'Invalid sessionId' })
    }
    if (err?.message?.startsWith('PAID_AI_DISABLED')) {
      return res.status(400).json({ error: 'Paid AI calls are disabled', message: err.message })
    }
    if (err?.message?.startsWith('EMBEDDING_MODE_MISMATCH')) {
      return res.status(409).json({ error: 'Embedding mode mismatch', message: err.message })
    }
    if (err?.message?.startsWith('RAG_STORAGE_UNCONFIGURED')) {
      return res.status(500).json({ error: 'Storage is not configured for Production', message: err.message })
    }
    if (err?.message?.includes('OPENAI_API_KEY')) {
      return res.status(400).json({
        error: 'OpenAI API key is missing or invalid',
        message:
          'Please add your OpenAI API key to .env.local file. Get your key from https://platform.openai.com/api-keys',
      })
    }
    if (err?.message?.includes('at most')) {
      return res.status(400).json({ error: err.message })
    }
    if (err?.message?.includes('Only previously uploaded files')) {
      return res.status(400).json({ error: 'Only files uploaded to this session can be indexed' })
    }
    if (err?.message?.includes('File not found in this session')) {
      return res.status(404).json({ error: err.message.replace('Failed to load document ', '') })
    }

    return res.status(500).json({ error: err?.message ?? 'Internal error' })
  }
}
