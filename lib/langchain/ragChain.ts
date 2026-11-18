import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { StringOutputParser } from '@langchain/core/output_parsers'
import type { MessageContentComplex, MessageContentText } from '@langchain/core/messages'
import { formatDocumentsAsString } from 'langchain/util/document'
import { searchSession } from './retriever'
import { buildRagPrompt } from '@/utils/promptTemplates'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import type { HistoryTurn } from '@/lib/brain'
import { mockChatStream, RAG_MOCK_ENABLED, PAID_AI_DISABLED, paidAIAllowed } from '@/lib/ai/mock'

/**
 * StringOutputParser, but tolerant of non-text content parts. On Claude 5.x
 * thinking is adaptive and on by default
 * (https://docs.anthropic.com/en/docs/build-with-claude/thinking): when a
 * request leaves `thinking` unset the model may stream thinking blocks, and
 * the stock parser then throws `Cannot coerce "thinking" message part into
 * a string`, losing the whole answer (production /api/query log, NOV 18
 * 10:13:40 + 10:13:58).
 *
 * Text and text_delta parts stream through unchanged; thinking,
 * redacted_thinking, tool_use and any other part type are dropped (this
 * chain binds no tools, so nothing renderable is lost). Limit: a response
 * containing no text at all yields zero tokens - runRagQuery turns that
 * into EMPTY_MODEL_RESPONSE instead of returning a silent empty answer.
 */
class TextOnlyOutputParser extends StringOutputParser {
  static lc_name() {
    return 'TextOnlyOutputParser'
  }

  protected override _messageContentComplexToString(content: MessageContentComplex): string {
    if ((content.type === 'text' || content.type === 'text_delta') && 'text' in content) {
      return (content as MessageContentText).text
    }
    return ''
  }
}

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
  opts: {
    expectContext?: boolean
    anthropicKey?: string
    /** Recent turns of THIS conversation, so follow-ups and earlier facts resolve. */
    history?: HistoryTurn[]
    /** Second brain: retrieval over a possibly empty space is fine, not INDEX_MISSING. */
    allowEmptyIndex?: boolean
    /** Pre-formatted saved notes (second brain); '(none)' otherwise. */
    notes?: string
  } = {}
): Promise<RagResult> {
  let context = ''
  let sources: SourceCitation[] = []

  if (opts.expectContext) {
    const retrieved = await searchSession(sessionId, query, 5, {
      allowEmpty: opts.allowEmptyIndex,
    }) // throws INDEX_MISSING unless allowEmptyIndex
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
  const history = (opts.history ?? []).map((t) =>
    t.role === 'user' ? new HumanMessage(t.content) : new AIMessage(t.content)
  )

  // BYOK: the visitor supplies their own Anthropic key for this request.
  // The key lives only in this invocation — never persisted, never logged.
  // A user-supplied key IS the paid opt-in for this call, so it bypasses the
  // server-side fail-closed guard (which protects OUR keys, not theirs).
  if (opts.anthropicKey) {
    const llm = new ChatAnthropic({
      apiKey: opts.anthropicKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      streaming: true,
      // Bound each answer's spend; longer answers are simply cut off.
      maxTokens: 2048,
      // Current Claude models reject sampling params entirely: `top_p: -1`
      // (langchain 0.3.x default, production log req_011ChA1BnQNTQADW24LrRPFm)
      // and even an explicit `temperature` (400 "deprecated for this model",
      // req_011ChA3HhXq5Hw16wkjrFeuW). Omit all three via invocationKwargs:
      // undefined keys drop out of the JSON.
      // `thinking` is the opposite case. On Claude Haiku 5.5 thinking is
      // adaptive and ON by default; omitting the field let the model stream
      // thinking blocks (the 10:13 crash - see TextOnlyOutputParser above).
      // Per https://docs.anthropic.com/en/docs/build-with-claude/thinking,
      // Haiku 5.5 accepts "disabled" at high effort or below, and the
      // default effort on Haiku 5.5 is medium
      // (https://docs.anthropic.com/en/docs/build-with-claude/adaptive-thinking);
      // this request sets no effort. Thinking tokens are billed as output
      // tokens even when hidden, so disabling also avoids that spend per
      // answer. langchain's own default here is {type:'disabled'}, but PR #5
      // showed what happens when it drops out of the serialized request -
      // set it explicitly.
      thinking: { type: 'disabled' },
      invocationKwargs: {
        temperature: undefined,
        top_p: undefined,
        top_k: undefined,
      },
    })
    const chain = prompt.pipe(llm).pipe(new TextOnlyOutputParser())
    const stream = await chain.stream({ context, question: query, history, notes: opts.notes ?? '(none)' })
    let answered = false
    for await (const chunk of stream) {
      if (typeof chunk === 'string' && chunk.length > 0) {
        answered = true
        onToken(chunk)
      }
    }
    // A textless response (e.g. max_tokens exhausted mid-thought, or only
    // non-text parts) must fail loudly, never succeed as an empty answer.
    if (!answered) throw new Error('EMPTY_MODEL_RESPONSE')
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

  const chain = prompt.pipe(llm).pipe(new TextOnlyOutputParser())
  const stream = await chain.stream({ context, question: query, history, notes: opts.notes ?? '(none)' })

  let answered = false
  for await (const chunk of stream) {
    if (typeof chunk === 'string' && chunk.length > 0) {
      answered = true
      onToken(chunk)
    }
  }
  if (!answered) throw new Error('EMPTY_MODEL_RESPONSE')

  return { sources, usedContext: context.length > 0 }
}
