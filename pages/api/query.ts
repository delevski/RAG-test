import type { NextApiRequest, NextApiResponse } from 'next'
import { validateAnthropicKey } from '@/lib/ai/byok'
import { runRagQuery } from '@/lib/langchain/ragChain'
import { assertValidSessionId, MAX_QUERY_CHARS } from '@/lib/langchain/retriever'
import { RAG_MOCK_ENABLED, PAID_AI_DISABLED, paidAIAllowed } from '@/lib/ai/mock'

/**
 * Answer stream protocol (text/plain):
 *   1. The answer text is streamed as-is.
 *   2. When retrieved context was used, a single trailer chunk follows:
 *      "\n\n__SOURCES__" + JSON.stringify(SourceCitation[])
 * The trailer is written in one write() after the model stream completes,
 * and the client parses it only after the stream ends — so token boundaries
 * can never corrupt it. Citations always describe chunks actually retrieved
 * server-side, never model-invented references.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed')
  const { sessionId, query, expectContext, anthropicKey } = req.body as {
    sessionId: string
    query: string
    expectContext?: boolean
    anthropicKey?: unknown
  }
  try {
    assertValidSessionId(sessionId)
  } catch {
    return res.status(400).end('Invalid sessionId')
  }
  if (!query || typeof query !== 'string') return res.status(400).end('Missing query')
  if (query.length > MAX_QUERY_CHARS) {
    return res.status(400).end(`Query is limited to ${MAX_QUERY_CHARS} characters`)
  }

  // BYOK: a visitor-supplied Anthropic key is validated in shape only, used
  // for this single request, and never persisted or logged.
  let userAnthropicKey: string | undefined
  try {
    userAnthropicKey = validateAnthropicKey(anthropicKey) ?? undefined
  } catch {
    return res.status(400).end('Invalid Anthropic API key format')
  }

  if (!userAnthropicKey && !RAG_MOCK_ENABLED) {
    if (!paidAIAllowed()) {
      return res.status(400).end(PAID_AI_DISABLED)
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).end('OPENAI_API_KEY is missing')
    }
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')

  try {
    const { sources } = await runRagQuery(sessionId, query, (token) => res.write(token), {
      expectContext: Boolean(expectContext),
      anthropicKey: userAnthropicKey,
    })
    if (sources.length > 0) {
      res.write(`\n\n__SOURCES__${JSON.stringify(sources)}`)
    }
    res.end()
  } catch (err: any) {
    if (err?.message === 'INDEX_MISSING') {
      // The index lived in /tmp of a different instance. Re-indexing spends
      // the API key, so the client must ask the user first.
      res.status(409).json({ error: 'INDEX_MISSING' })
      return
    }
    if (err?.message?.startsWith('EMBEDDING_MODE_MISMATCH')) {
      res.status(409).json({ error: 'EMBEDDING_MODE_MISMATCH', message: err.message })
      return
    }
    if (err?.message?.startsWith('PAID_AI_DISABLED')) {
      res.status(400).end(err.message)
      return
    }
    if (err?.message?.startsWith('RAG_STORAGE_UNCONFIGURED')) {
      res.status(500).end(err.message)
      return
    }
    // Never echo provider error bodies back: they can quote the request key.
    console.error('query error', err?.message ?? err)
    if (userAnthropicKey) {
      const status = err?.status ?? err?.error?.status
      if (status === 401) return res.status(502).end('Anthropic rejected the API key')
      return res.status(502).end('Anthropic request failed')
    }
    res.status(500).end(err?.message ?? 'Internal error')
  }
}
