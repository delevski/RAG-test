import fs from 'node:fs'
import path from 'node:path'
import { Document } from '@langchain/core/documents'
import type { Embeddings } from '@langchain/core/embeddings'

/**
 * JsonVectorStore — a dependency-free vector store.
 *
 * Why this exists: the project previously used `faiss-node`, a native module
 * that is heavy to install and unreliable in serverless environments. This
 * store is pure TypeScript: cosine similarity over chunk embeddings,
 * persisted as a single JSON file per session.
 *
 * Persistence note: the storage directory is /tmp on serverless platforms,
 * so an index survives warm invocations of the same instance but is NOT
 * durable across cold starts. The API layer surfaces a missing index
 * explicitly (INDEX_MISSING) instead of silently re-embedding.
 */

export type StoredChunk = {
  content: string
  metadata: Record<string, any>
  embedding: number[]
}

const STORE_VERSION = 1
const INDEX_FILE = 'index.json'

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export class JsonVectorStore {
  private chunks: StoredChunk[]

  constructor(chunks: StoredChunk[] = []) {
    this.chunks = chunks
  }

  get size(): number {
    return this.chunks.length
  }

  static async fromDocuments(docs: Document[], embeddings: Embeddings): Promise<JsonVectorStore> {
    const store = new JsonVectorStore()
    await store.addDocuments(docs, embeddings)
    return store
  }

  async addDocuments(docs: Document[], embeddings: Embeddings): Promise<void> {
    if (docs.length === 0) return
    const vectors = await embeddings.embedDocuments(docs.map((d) => d.pageContent))
    docs.forEach((d, i) => {
      this.chunks.push({
        content: d.pageContent,
        metadata: (d.metadata as Record<string, any>) ?? {},
        embedding: vectors[i],
      })
    })
  }

  async similaritySearch(query: string, k: number, embeddings: Embeddings): Promise<Document[]> {
    const [queryVector] = await embeddings.embedDocuments([query])
    return this.similaritySearchByVector(queryVector, k)
  }

  similaritySearchByVector(queryVector: number[], k: number): Document[] {
    return this.chunks
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryVector, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(
        ({ chunk }) =>
          new Document({ pageContent: chunk.content, metadata: chunk.metadata })
      )
  }

  async save(directory: string): Promise<void> {
    await fs.promises.mkdir(directory, { recursive: true })
    const payload = JSON.stringify({ version: STORE_VERSION, chunks: this.chunks })
    const tmpFile = path.join(directory, `${INDEX_FILE}.tmp`)
    await fs.promises.writeFile(tmpFile, payload, 'utf8')
    await fs.promises.rename(tmpFile, path.join(directory, INDEX_FILE))
  }

  static async load(directory: string): Promise<JsonVectorStore> {
    const raw = await fs.promises.readFile(path.join(directory, INDEX_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed?.chunks)) {
      throw new Error('Unsupported vector store format')
    }
    return new JsonVectorStore(parsed.chunks)
  }

  static exists(directory: string): boolean {
    return fs.existsSync(path.join(directory, INDEX_FILE))
  }
}
