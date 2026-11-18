import type { NextApiRequest, NextApiResponse } from 'next'
import { validateAnthropicKey } from '@/lib/ai/byok'
import {
  resolveClaudeKey,
  OWNER_MODE_NOT_CONFIGURED,
  OWNER_TOKEN_INVALID,
} from '@/lib/ai/ownerKey'
import { runRagQuery } from '@/lib/langchain/ragChain'
import { assertValidSessionId, MAX_QUERY_CHARS } from '@/lib/langchain/retriever'
import { getSessionStore } from '@/lib/store/sessionStore'
import {
  assertBrainAccess,
  isBrainSession,
  sanitizeHistory,
  sanitizeConversationId,
  noteFromUserMessage,
  selectNotes,
  formatNotes,
  MAX_NOTES,
  BRAIN_FORBIDDEN,
} from '@/lib/brain'
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

/** Tells the model memory really is on, so it never claims it cannot remember across chats. */
const BRAIN_MEMORY_NOTICE =
  '(Memory is ON: every statement the user makes is saved automatically as a note and is available in all future conversations. Never say you cannot remember across conversations. The notes below are what is saved so far.)'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed')
  const { sessionId, query, expectContext, anthropicKey, ownerToken, history, conversationId } = req.body as {
    sessionId: string
    query: string
    expectContext?: boolean
    anthropicKey?: unknown
    ownerToken?: unknown
    history?: unknown
    conversationId?: unknown
  }
  try {
    assertValidSessionId(sessionId)
  } catch {
    return res.status(400).end('Invalid sessionId')
  }
  // The owner's second brain is reachable only with the owner passphrase.
  try {
    assertBrainAccess(req, sessionId)
  } catch (err: any) {
    if (err?.message === BRAIN_FORBIDDEN) {
      await new Promise((r) => setTimeout(r, 600))
      return res.status(403).end('Owner passphrase required')
    }
    throw err
  }
  const brain = isBrainSession(sessionId)
  if (!query || typeof query !== 'string') return res.status(400).end('Missing query')
  if (query.length > MAX_QUERY_CHARS) {
    return res.status(400).end(`Query is limited to ${MAX_QUERY_CHARS} characters`)
  }

  // Claude access for this request, in precedence order:
  // 1. Owner mode: a matching ownerToken unlocks the server-side key (the
  //    site is public, so the stored key is never spendable without it).
  //    A wrong token fails loudly - no silent fallback.
  // 2. BYOK: a visitor-supplied key, shape-validated, used for this single
  //    request, never persisted or logged.
  let claude: { key: string; source: 'owner' | 'byok' } | null = null
  try {
    const resolved = resolveClaudeKey({ ownerToken, anthropicKey })
    if (resolved.source === 'owner') claude = { key: resolved.key, source: 'owner' }
    else if (resolved.source === 'byok') {
      claude = { key: validateAnthropicKey(resolved.key) as string, source: 'byok' }
    }
  } catch (err: any) {
    if (err?.message === OWNER_TOKEN_INVALID) {
      // Uniform small delay: slows online brute force against the token,
      // and no provider work (spend) ever happens on this path.
      await new Promise((r) => setTimeout(r, 600))
      return res.status(403).end('Invalid owner token')
    }
    if (err?.message?.startsWith('OWNER_MODE_NOT_CONFIGURED')) {
      return res.status(400).end('Owner mode is not configured on this deployment')
    }
    return res.status(400).end('Invalid Anthropic API key format')
  }
  const userAnthropicKey = claude?.key

  if (!claude && !RAG_MOCK_ENABLED) {
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
    let answerText = ''
    let notesText = '(none)'
    if (brain) {
      const store = await getSessionStore()
      const all = await store.listNotes(sessionId)
      const chosen = selectNotes(all, query)
      notesText =
        BRAIN_MEMORY_NOTICE + '\n' + formatNotes(chosen, all.length - chosen.length)
    }
    const { sources } = await runRagQuery(
      sessionId,
      query,
      (token) => {
        answerText += token
        res.write(token)
      },
      {
        // The brain always searches (documents AND remembered conversations).
        expectContext: brain ? true : Boolean(expectContext),
        allowEmptyIndex: brain,
        anthropicKey: userAnthropicKey,
        history: sanitizeHistory(history),
        notes: notesText,
      }
    )
    if (brain) {
      // Save the finished turn: chat history (per conversation) and, for a
      // statement, a memory note. A storage hiccup must never turn a good
      // answer into an error, so it is logged and swallowed.
      try {
        const store = await getSessionStore()
        const ts = new Date().toISOString()
        await store.appendMessages(sessionId, sanitizeConversationId(conversationId), [
          { role: 'user', content: query.slice(0, MAX_QUERY_CHARS), ts },
          { role: 'assistant', content: answerText.slice(0, 20000), ts, sources },
        ])
        const note = noteFromUserMessage(query)
        if (note) {
          const existing = await store.listNotes(sessionId)
          if (existing.length < MAX_NOTES && !existing.some((n) => n.text === note)) {
            await store.addNote(sessionId, note)
          }
        }
      } catch (e: any) {
        console.error('brain remember error', e?.message ?? e)
      }
    }
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
