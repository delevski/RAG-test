import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings'

/**
 * Mock AI provider (RAG_MOCK=1).
 *
 * Exists so the full pipeline — upload -> index -> retrieve -> stream ->
 * citations — can be exercised end to end in CI and local development
 * without any paid API calls. NEVER enabled by default; the real OpenAI
 * provider is used unless RAG_MOCK is explicitly set to "1".
 *
 * Embeddings are deterministic bag-of-words vectors, so texts that share
 * tokens genuinely rank closer — retrieval behavior stays meaningful.
 */

export const RAG_MOCK_ENABLED = process.env.RAG_MOCK === '1'

const MOCK_DIM = 128

function hashToken(token: string): number {
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function textToVector(text: string): number[] {
  const v = new Array(MOCK_DIM).fill(0)
  const tokens = text.toLowerCase().split(/[^a-z0-9\u0590-\u05ff]+/i)
  for (const tok of tokens) {
    if (!tok) continue
    const h = hashToken(tok)
    v[h % MOCK_DIM] += 1
    v[(h >>> 8) % MOCK_DIM] += 0.5
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export class MockEmbeddings extends Embeddings {
  constructor(params?: EmbeddingsParams) {
    super(params ?? {})
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(textToVector)
  }

  async embedQuery(text: string): Promise<number[]> {
    return textToVector(text)
  }
}

export async function* mockChatStream(query: string, context: string): AsyncGenerator<string> {
  const chunks = context.trim().length > 0 ? context.trim().split('\n\n').length : 0
  const answer =
    chunks > 0
      ? `**Mock answer** (RAG_MOCK=1, no paid API calls were made).\n\n` +
        `You asked: "${query}".\n\n` +
        `I retrieved ${chunks} relevant chunk(s) from your uploaded documents, ` +
        `and a real chat model would ground its answer in them. The citations below ` +
        `point at the actual retrieved chunks.`
      : `**Mock answer** (RAG_MOCK=1, no paid API calls were made).\n\n` +
        `You asked: "${query}".\n\n` +
        `No documents are indexed for this session, so this is the plain chat path ` +
        `with no retrieved context.`
  for (const word of answer.split(' ')) {
    yield word + ' '
    await new Promise((r) => setTimeout(r, 10))
  }
}
