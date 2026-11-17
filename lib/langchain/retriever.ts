import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { Document } from '@langchain/core/documents'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { OpenAIEmbeddings } from '@langchain/openai'
import { JsonVectorStore } from '@/lib/vectorstore/jsonVectorStore'
import { MockEmbeddings, RAG_MOCK_ENABLED } from '@/lib/ai/mock'

// ---------------------------------------------------------------------------
// Bounds — keep a single session (and a single serverless instance) sane.
// ---------------------------------------------------------------------------
export const MAX_DOCS_PER_SESSION = 10
export const MAX_CHUNKS_PER_SESSION = 1500
export const MAX_QUERY_CHARS = 4000

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 150

// /tmp is the only writable path on serverless platforms (Vercel, Lambda).
// Indexes there are NOT durable across cold starts — see INDEX_MISSING.
const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
)
const DATA_DIR = isServerless
  ? path.join('/tmp', '.data', 'vectors')
  : path.join(process.cwd(), '.data', 'vectors')

// Session IDs come from the client; strict validation keeps every session in
// its own directory and prevents path tricks or cross-session access.
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/

export function assertValidSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid sessionId')
  }
}

function sessionDir(sessionId: string): string {
  assertValidSessionId(sessionId)
  return path.join(DATA_DIR, `session-${sessionId}`)
}

type Manifest = { docs: Array<{ url: string; name?: string }> }

function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.json')
}

function readManifest(dir: string): Manifest {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'))
  } catch {
    return { docs: [] }
  }
}

function createEmbeddings() {
  if (RAG_MOCK_ENABLED) return new MockEmbeddings()
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY environment variable is missing. Please add it to your .env.local file.'
    )
  }
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  })
}

async function downloadToTemp(url: string, filenameHint?: string): Promise<string> {
  if (url.startsWith('/api/files/')) {
    const filename = url.split('/').pop() || ''
    const uploadsDir = isServerless
      ? path.join('/tmp', 'uploads')
      : path.join(process.cwd(), 'uploads')

    let filePath = path.join(uploadsDir, filename)
    if (!fs.existsSync(filePath) && !isServerless) {
      const tmpPath = path.join('/tmp', 'uploads', filename)
      if (fs.existsSync(tmpPath)) filePath = tmpPath
    }
    if (fs.existsSync(filePath)) return filePath
    throw new Error(`Local file not found: ${filename}`)
  }

  const fullUrl = url.startsWith('http') ? url : `http://localhost:${process.env.PORT || 3000}${url}`
  const res = await fetch(fullUrl)
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const ext = (
    filenameHint?.split('.').pop() ||
    url.split('?')[0].split('.').pop() ||
    'bin'
  ).toLowerCase()
  const tmp = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  await fs.promises.writeFile(tmp, bytes)
  return tmp
}

async function loadDocumentsFromUrl(url: string, name?: string): Promise<Document[]> {
  const filePath = await downloadToTemp(url, name)
  const isLocalFile = url.startsWith('/api/files/')
  const ext = filePath.split('.').pop()?.toLowerCase()
  let loader
  if (ext === 'pdf') loader = new PDFLoader(filePath)
  else if (ext === 'docx' || ext === 'doc') loader = new DocxLoader(filePath)
  else loader = new TextLoader(filePath)
  const docs = await loader.load()
  // Bind every chunk to the original document name for citations.
  for (const d of docs) {
    d.metadata = { ...d.metadata, docName: name || path.basename(filePath) }
  }
  if (!isLocalFile) {
    await fs.promises.unlink(filePath).catch(() => {})
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
  inputs: Array<{ url: string; name?: string }>
): Promise<IndexResult> {
  assertValidSessionId(sessionId)
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('No documents provided for indexing')
  }

  const dir = sessionDir(sessionId)
  const manifest = readManifest(dir)
  const knownUrls = new Set(manifest.docs.map((d) => d.url))
  const newInputs = inputs.filter((d) => !knownUrls.has(d.url))
  const skipped = inputs.filter((d) => knownUrls.has(d.url)).map((d) => d.url)

  if (manifest.docs.length + newInputs.length > MAX_DOCS_PER_SESSION) {
    throw new Error(`A session can hold at most ${MAX_DOCS_PER_SESSION} documents`)
  }

  if (newInputs.length === 0) {
    const existing = JsonVectorStore.exists(dir) ? await JsonVectorStore.load(dir) : null
    return { indexed: [], skipped, totalChunks: existing?.size ?? 0 }
  }

  const rawDocs: Document[] = []
  for (const d of newInputs) {
    try {
      rawDocs.push(...(await loadDocumentsFromUrl(d.url, d.name)))
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

  let store: JsonVectorStore
  if (JsonVectorStore.exists(dir)) {
    store = await JsonVectorStore.load(dir)
  } else {
    store = new JsonVectorStore()
  }

  if (store.size + chunks.length > MAX_CHUNKS_PER_SESSION) {
    throw new Error(
      `Session index is limited to ${MAX_CHUNKS_PER_SESSION} chunks; these documents would exceed it`
    )
  }

  await store.addDocuments(chunks, embeddings)
  await store.save(dir)

  manifest.docs.push(...newInputs.map((d) => ({ url: d.url, name: d.name })))
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(manifestPath(dir), JSON.stringify(manifest, null, 2), 'utf8')

  return { indexed: newInputs.map((d) => d.url), skipped, totalChunks: store.size }
}

export function isSessionIndexed(sessionId: string): boolean {
  return JsonVectorStore.exists(sessionDir(sessionId))
}

/**
 * Similarity search within ONE session's store. Throws when the session has
 * no index — callers decide how to surface that (never silently re-embed).
 */
export async function searchSession(sessionId: string, query: string, k = 5): Promise<Document[]> {
  assertValidSessionId(sessionId)
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`Query is limited to ${MAX_QUERY_CHARS} characters`)
  }
  const dir = sessionDir(sessionId)
  if (!JsonVectorStore.exists(dir)) {
    throw new Error('INDEX_MISSING')
  }
  const store = await JsonVectorStore.load(dir)
  const embeddings = createEmbeddings()
  return store.similaritySearch(query, k, embeddings)
}
