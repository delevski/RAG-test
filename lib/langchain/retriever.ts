import fs from 'node:fs'
import path from 'node:path'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { Document } from '@langchain/core/documents'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { OpenAIEmbeddings } from '@langchain/openai'
import { JsonVectorStore } from '@/lib/vectorstore/jsonVectorStore'
import {
  MockEmbeddings,
  RAG_MOCK_ENABLED,
  PAID_AI_DISABLED,
  activeEmbeddingSpec,
  assertEmbeddingCompatibility,
  paidAIAllowed,
} from '@/lib/ai/mock'
import { getSessionStore, type StoredMessage } from '@/lib/store/sessionStore'
import { isBrainSession, BRAIN_MAX_DOCS, BRAIN_MAX_CHUNKS } from '@/lib/brain'
import {
  assertValidSessionId as assertSession,
  sessionDataDir,
  sessionUploadDir,
} from '@/lib/store/fileStore'

// ---------------------------------------------------------------------------
// Bounds — keep a single session (and a single serverless instance) sane.
// ---------------------------------------------------------------------------
export const MAX_DOCS_PER_SESSION = 10
export const MAX_CHUNKS_PER_SESSION = 1500
export const MAX_QUERY_CHARS = 4000

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 150

// Session validation and upload paths live in the store layer; re-exported
// here so existing API routes keep their imports.
export { sessionUploadDir }
export function assertValidSessionId(sessionId: unknown): asserts sessionId is string {
  assertSession(sessionId)
}

function createEmbeddings() {
  if (RAG_MOCK_ENABLED) return new MockEmbeddings()
  // Fail-closed: real (paid) embedding calls require an explicit opt-in.
  if (!paidAIAllowed()) {
    throw new Error(PAID_AI_DISABLED)
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY environment variable is missing. Please add it to your .env.local file.'
    )
  }
  return new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  })
}

/**
 * Resolve a document URL to a local file inside the OWNING session's upload
 * directory. Only files previously uploaded through /api/upload can be
 * indexed: external URLs are rejected outright (no SSRF surface), and one
 * session can never read another session's files by name.
 */
async function resolveSessionFile(url: string, sessionId: string): Promise<string> {
  const match = url.match(/^\/api\/files\/([^/?]+)(\?.*)?$/)
  if (!match) {
    throw new Error('Only previously uploaded files can be indexed')
  }
  const filename = path.basename(match[1])
  const dir = sessionUploadDir(sessionId)
  const filePath = path.join(dir, filename)
  if (path.resolve(filePath) !== path.resolve(path.join(dir, filename))) {
    throw new Error('Invalid file path')
  }
  if (!fs.existsSync(filePath)) {
    // Cold start on serverless wiped the working copy; restore the bytes
    // from the durable store (Neon) when one is configured.
    const store = await getSessionStore()
    const content = await store.getFile(sessionId, filename)
    if (!content) {
      throw new Error(`File not found in this session: ${filename}`)
    }
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(filePath, content)
  }
  return filePath
}

async function loadDocumentsFromUrl(
  url: string,
  sessionId: string,
  name?: string
): Promise<Document[]> {
  const filePath = await resolveSessionFile(url, sessionId)
  const ext = filePath.split('.').pop()?.toLowerCase()
  let loader
  if (ext === 'pdf') loader = new PDFLoader(filePath)
  else if (ext === 'docx' || ext === 'doc') loader = new DocxLoader(filePath)
  else loader = new TextLoader(filePath)
  const docs = await loader.load()
  // Bind every chunk to the original document name for citations.
  for (const d of docs) {
    d.metadata = { ...d.metadata, docName: name || path.basename(filePath), docUrl: url }
  }
  return docs
}

export type IndexResult = {
  indexed: string[]
  skipped: string[]
  totalChunks: number
}

/**
 * Index documents for a session. Idempotent: documents whose URL is already
 * in the session manifest are skipped, so a client retry never double-embeds
 * (and never double-charges). Only genuinely new documents cost API calls.
 */
export async function indexDocuments(
  sessionId: string,
  inputs: Array<{ url: string; name?: string; size?: number; type?: string }>
): Promise<IndexResult> {
  assertValidSessionId(sessionId)
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('No documents provided for indexing')
  }

  const store = await getSessionStore()
  const snapshot = (await store.loadSession(sessionId)) ?? { docs: [], chunks: [] }
  const knownUrls = new Set(snapshot.docs.map((d) => d.url))
  const newInputs = inputs.filter((d) => !knownUrls.has(d.url))
  const skipped = inputs.filter((d) => knownUrls.has(d.url)).map((d) => d.url)

  const brain = isBrainSession(sessionId)
  const maxDocs = brain ? BRAIN_MAX_DOCS : MAX_DOCS_PER_SESSION
  const maxChunks = brain ? BRAIN_MAX_CHUNKS : MAX_CHUNKS_PER_SESSION
  const realDocCount = snapshot.docs.filter((d) => !isMemoryDoc(d.url)).length
  if (realDocCount + newInputs.length > maxDocs) {
    throw new Error(`A session can hold at most ${maxDocs} documents`)
  }

  if (newInputs.length === 0) {
    return { indexed: [], skipped, totalChunks: snapshot.chunks.length }
  }

  const rawDocs: Document[] = []
  for (const d of newInputs) {
    try {
      rawDocs.push(...(await loadDocumentsFromUrl(d.url, sessionId, d.name)))
    } catch (error: any) {
      throw new Error(`Failed to load document ${d.name || d.url}: ${error.message}`)
    }
  }
  if (rawDocs.length === 0) {
    throw new Error('No documents were successfully loaded')
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  })
  const chunks = await splitter.splitDocuments(rawDocs)
  if (chunks.length === 0) {
    throw new Error('No text chunks were created from documents')
  }

  const embeddings = createEmbeddings()
  // Refuse to mix embedding modes in one session: chunks embedded by a
  // different model/dimension would silently corrupt ranking. Data is kept;
  // the caller decides to switch back or re-index.
  assertEmbeddingCompatibility(
    snapshot.chunks.map((c) => c.embedding.length),
    activeEmbeddingSpec()
  )
  // Stamp every new chunk with the embedding identity for later validation.
  const spec = activeEmbeddingSpec()
  for (const chunk of chunks) {
    chunk.metadata = { ...chunk.metadata, embeddingModel: spec.model, embeddingDim: spec.dim }
  }
  const engine = new JsonVectorStore(snapshot.chunks)

  if (engine.size + chunks.length > maxChunks) {
    throw new Error(
      `Session index is limited to ${maxChunks} chunks; these documents would exceed it`
    )
  }

  const newRecords = newInputs.map((d) => ({
    url: d.url,
    filename: path.basename(d.url.split('?')[0]),
    name: d.name,
    size: typeof d.size === 'number' && d.size >= 0 ? d.size : undefined,
    type: typeof d.type === 'string' ? d.type.slice(0, 200) : undefined,
  }))

  if (brain) {
    // Second brain: embed only the NEW chunks and append them; the existing
    // knowledge is never rewritten.
    const before = engine.size
    await engine.addDocuments(chunks, embeddings)
    await store.appendDocsAndChunks(sessionId, newRecords, engine.toChunks().slice(before))
    return { indexed: newInputs.map((d) => d.url), skipped, totalChunks: engine.size }
  }

  await engine.addDocuments(chunks, embeddings)
  snapshot.docs.push(...newRecords)
  snapshot.chunks = engine.toChunks()
  await store.saveSession(sessionId, snapshot)

  return { indexed: newInputs.map((d) => d.url), skipped, totalChunks: engine.size }
}

export async function isSessionIndexed(sessionId: string): Promise<boolean> {
  const store = await getSessionStore()
  const snapshot = await store.loadSession(sessionId)
  return Boolean(snapshot && snapshot.chunks.length > 0)
}

/**
 * Remove one document from a session: manifest entry, its chunks (tagged
 * with docUrl at index time) and the stored file bytes. After this, a
 * refresh hydrates without the document — removal is real, not cosmetic.
 */
export async function removeSessionDoc(sessionId: string, url: string): Promise<void> {
  assertValidSessionId(sessionId)
  const store = await getSessionStore()
  const snapshot = await store.loadSession(sessionId)
  if (!snapshot) return
  const doc = snapshot.docs.find((d) => d.url === url)
  snapshot.docs = snapshot.docs.filter((d) => d.url !== url)
  snapshot.chunks = snapshot.chunks.filter((c) => c.metadata?.docUrl !== url)
  await store.saveSession(sessionId, snapshot)
  if (doc) {
    await store.deleteFile(sessionId, doc.filename)
    // Best-effort local cleanup of the working copy too.
    try {
      fs.unlinkSync(path.join(sessionUploadDir(sessionId), path.basename(doc.filename)))
    } catch {
      /* already gone */
    }
  }
}

/** Session-scoped document listing for client hydration after a refresh. */
export async function listSessionDocs(
  sessionId: string
): Promise<{
  docs: Array<{ url: string; name?: string; filename: string; size?: number; type?: string }>
  totalChunks: number
}> {
  assertValidSessionId(sessionId)
  const store = await getSessionStore()
  const snapshot = await store.loadSession(sessionId)
  if (!snapshot) return { docs: [], totalChunks: 0 }
  return {
    docs: snapshot.docs.filter((d) => !isMemoryDoc(d.url)).map((d) => ({
      url: d.url,
      name: d.name,
      filename: d.filename,
      size: d.size,
      type: d.type,
    })),
    totalChunks: snapshot.chunks.length,
  }
}

/**
 * Similarity search within ONE session's store. Throws when the session has
 * no index — callers decide how to surface that (never silently re-embed).
 */
export async function searchSession(
  sessionId: string,
  query: string,
  k = 5,
  opts: { allowEmpty?: boolean } = {}
): Promise<Document[]> {
  assertValidSessionId(sessionId)
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Query is limited to ${MAX_QUERY_CHARS} characters`)
  }
  const store = await getSessionStore()
  const snapshot = await store.loadSession(sessionId)
  if (!snapshot || snapshot.chunks.length === 0) {
    // The second brain starts empty by design; a visitor session that expects
    // an index still gets the explicit INDEX_MISSING.
    if (opts.allowEmpty) return []
    throw new Error('INDEX_MISSING')
  }
  const engine = new JsonVectorStore(snapshot.chunks)
  const embeddings = createEmbeddings()
  assertEmbeddingCompatibility(
    snapshot.chunks.map((c) => c.embedding.length),
    activeEmbeddingSpec()
  )
  return engine.similaritySearch(query, k, embeddings)
}

// ---------------------------------------------------------------------------
// Conversation memory (second brain)
// ---------------------------------------------------------------------------
export const MEMORY_DOC_URL = 'memory:conversation'
export function isMemoryDoc(url: string): boolean {
  return url === MEMORY_DOC_URL
}

/**
 * Save one finished turn into the owner's durable memory: the raw messages
 * (for history) and a retrievable chunk (so a later session can find the
 * fact). Only ever called for the owner-authenticated brain space.
 */
export async function rememberTurn(
  sessionId: string,
  turn: { user: string; assistant: string; sources?: Array<{ name: string; snippet: string }> }
): Promise<void> {
  assertValidSessionId(sessionId)
  const store = await getSessionStore()
  const ts = new Date().toISOString()
  const messages: StoredMessage[] = [
    { role: 'user', content: turn.user.slice(0, MAX_QUERY_CHARS), ts },
    { role: 'assistant', content: turn.assistant.slice(0, 20000), ts, sources: turn.sources },
  ]
  await store.appendMessages(sessionId, messages)
  const text = `Conversation on ${ts.slice(0, 10)}\nUser said: ${turn.user}\nAssistant answered: ${turn.assistant}`.slice(0, CHUNK_SIZE)
  const spec = activeEmbeddingSpec()
  const [embedding] = await createEmbeddings().embedDocuments([text])
  await store.appendDocsAndChunks(
    sessionId,
    [{ url: MEMORY_DOC_URL, filename: 'conversation-memory', name: 'Conversation memory', type: 'memory' }],
    [
      {
        content: text,
        metadata: {
          docName: 'Conversation memory',
          docUrl: MEMORY_DOC_URL,
          kind: 'memory',
          ts,
          embeddingModel: spec.model,
          embeddingDim: spec.dim,
        },
        embedding,
      },
    ]
  )
}
