import fs from 'node:fs'
import path from 'node:path'
import type { SessionDocRecord, SessionSnapshot, SessionStore } from './sessionStore'
import type { StoredChunk } from '@/lib/vectorstore/jsonVectorStore'

// /tmp is the only writable path on serverless platforms (Vercel, Lambda).
// Data there survives warm invocations but NOT cold starts; the Neon driver
// is the durable option (see sessionStore.ts).
const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
)
export const DATA_DIR = isServerless
  ? path.join('/tmp', '.data', 'vectors')
  : path.join(process.cwd(), '.data', 'vectors')

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/

export function assertValidSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid sessionId')
  }
}

export function sessionDataDir(sessionId: string): string {
  assertValidSessionId(sessionId)
  return path.join(DATA_DIR, `session-${sessionId}`)
}

/** Raw uploads live inside the owning session's directory, never globally. */
export function sessionUploadDir(sessionId: string): string {
  return path.join(sessionDataDir(sessionId), 'uploads')
}

type Manifest = { docs: SessionDocRecord[] }

export class FileSessionStore implements SessionStore {
  readonly driver = 'file' as const

  async loadSession(sessionId: string): Promise<SessionSnapshot | null> {
    const dir = sessionDataDir(sessionId)
    let docs: SessionDocRecord[] = []
    try {
      const manifest: Manifest = JSON.parse(
        await fs.promises.readFile(path.join(dir, 'manifest.json'), 'utf8')
      )
      docs = Array.isArray(manifest.docs) ? manifest.docs : []
    } catch {
      return null
    }
    let chunks: StoredChunk[] = []
    try {
      const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'index.json'), 'utf8'))
      if (raw?.version === 1 && Array.isArray(raw?.chunks)) chunks = raw.chunks
    } catch {
      /* no index yet */
    }
    return { docs, chunks }
  }

  async saveSession(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const dir = sessionDataDir(sessionId)
    await fs.promises.mkdir(dir, { recursive: true })
    const manifest: Manifest = { docs: snapshot.docs }
    await fs.promises.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    )
    const payload = JSON.stringify({ version: 1, chunks: snapshot.chunks })
    const tmpFile = path.join(dir, 'index.json.tmp')
    await fs.promises.writeFile(tmpFile, payload, 'utf8')
    await fs.promises.rename(tmpFile, path.join(dir, 'index.json'))
  }

  async putFile(sessionId: string, filename: string, content: Buffer): Promise<void> {
    const dir = sessionUploadDir(sessionId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, path.basename(filename)), content)
  }

  async getFile(sessionId: string, filename: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(
        path.join(sessionUploadDir(sessionId), path.basename(filename))
      )
    } catch {
      return null
    }
  }

  async deleteFile(sessionId: string, filename: string): Promise<void> {
    try {
      await fs.promises.unlink(path.join(sessionUploadDir(sessionId), path.basename(filename)))
    } catch {
      /* already gone */
    }
  }
}

