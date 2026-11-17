import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { formatDocumentsAsString } from 'langchain/util/document'
import { searchSession } from './retriever'
import { buildRagPrompt } from '@/utils/promptTemplates'
import { mockChatStream, RAG_MOCK_ENABLED, PAID_AI_DISABLED, paidAIAllowed } from '@/lib/ai/mock'

export type SourceCitation = {
  name: string
  snippet: string
}

export type RagResult = {
  /** Citations bound to the chunks actually retrieved for this answer. */
  sources: SourceCitation[]
  /** True when retrieved document context was part of the prompt. */
  usedContext: boolean
}

/**
 * Runs one RAG query.
 *
 * - When the caller marks the session as expecting context but no index
 *   exists (serverless cold start wiped /tmp), this throws INDEX_MISSING
 *   instead of silently re-embedding: re-indexing spends the API key, so it
 *   only happens on an explicit user action.
 * - Citations come ONLY from chunks actually retrieved here — never from
 *   model output.
 */
export async function runRagQuery(
  sessionId: string,
  query: string,
  onToken: (t: string) => void,
  opts: { expectContext?: boolean; anthropicKey?: string } = {}
): Promise<RagResult> {
  let context = ''
  let sources: SourceCitation[] = []

  if (opts.expectContext) {
    const retrieved = await searchSession(sessionId, query, 5) // throws INDEX_MISSING
    if (retrieved.length > 0) {
      context = formatDocumentsAsString(retrieved)
      const seen = new Set<string>()
      for (const d of retrieved) {
        const name = (d.metadata as any)?.docName || 'Document'
        const key = `${name}::${d.pageContent.slice(0, 80)}`
        if (seen.has(key)) continue
        seen.add(key)
        sources.push({ name, snippet: d.pageContent.replace(/\s+/g, ' ').slice(0, 220) })
      }
    }
  }

  const prompt = buildRagPrompt()

  // BYOK: the visitor supplies their own Anthropic key for this request.
  // The key lives only in this invocation — never persisted, never logged.
  // A user-supplied key IS the paid opt-in for this call, so it bypasses the
  // server-side fail-closed guard (which protects OUR keys, not theirs).
  if (opts.anthropicKey) {
    const llm = new ChatAnthropic({
      apiKey: opts.anthropicKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      temperature: 0.2,
      streaming: true,
    })
    const chain = prompt.pipe(llm).pipe(new StringOutputParser())
    const stream = await chain.stream({ context, question: query })
    for await (const chunk of stream) {
      if (typeof chunk === 'string') {
        onToken(chunk)
      }
    }
    return { sources, usedContext: context.length > 0 }
  }

  if (RAG_MOCK_ENABLED) {
    for await (const token of mockChatStream(query, context)) {
      onToken(token)
    }
    return { sources, usedContext: context.length > 0 }
  }

  // Fail-closed: real (paid) chat calls require an explicit opt-in.
  if (!paidAIAllowed()) {
    throw new Error(PAID_AI_DISABLED)
  }

  const llm = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    streaming: true,
    openAIApiKey: process.env.OPENAI_API_KEY,
  })

  const chain = prompt.pipe(llm).pipe(new StringOutputParser())
  const stream = await chain.stream({ context, question: query })

  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      onToken(chunk)
    }
  }

  return { sources, usedContext: context.length > 0 }
}
