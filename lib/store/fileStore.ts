import fs from 'node:fs'
import path from 'node:path'
import type {
  SessionDocRecord,
  SessionSnapshot,
  SessionStore,
  StoredConversation,
  StoredMessage,
  StoredNote,
} from './sessionStore'
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
      /* no manifest yet: a memory-only space may still hold an index */
    }
    let chunks: StoredChunk[] = []
    try {
      const raw = JSON.parse(await fs.promises.readFile(path.join(dir, 'index.json'), 'utf8'))
      if (raw?.version === 1 && Array.isArray(raw?.chunks)) chunks = raw.chunks
    } catch {
      /* no index yet */
    }
    if (docs.length === 0 && chunks.length === 0) return null
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

  async appendDocsAndChunks(
    sessionId: string,
    docs: SessionDocRecord[],
    chunks: StoredChunk[]
  ): Promise<void> {
    const snap = (await this.loadSession(sessionId)) ?? { docs: [], chunks: [] }
    const known = new Set(snap.docs.map((d) => d.url))
    snap.docs.push(...docs.filter((d) => !known.has(d.url)))
    snap.chunks.push(...chunks)
    await this.saveSession(sessionId, snap)
  }

  private async readMessages(sessionId: string): Promise<Array<StoredMessage & { c: string }>> {
    try {
      const raw = await fs.promises.readFile(path.join(sessionDataDir(sessionId), 'messages.jsonl'), 'utf8')
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }

  private async writeMessages(sessionId: string, rows: Array<StoredMessage & { c: string }>) {
    const dir = sessionDataDir(sessionId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(
      path.join(dir, 'messages.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
      'utf8'
    )
  }

  async appendMessages(sessionId: string, conversationId: string, messages: StoredMessage[]): Promise<void> {
    const dir = sessionDataDir(sessionId)
    await fs.promises.mkdir(dir, { recursive: true })
    const lines = messages.map((m) => JSON.stringify({ ...m, c: conversationId })).join('\n') + '\n'
    await fs.promises.appendFile(path.join(dir, 'messages.jsonl'), lines, 'utf8')
  }

  async listMessages(sessionId: string, conversationId: string, limit: number): Promise<StoredMessage[]> {
    const rows = await this.readMessages(sessionId)
    return rows
      .filter((r) => r.c === conversationId)
      .slice(-limit)
      .map(({ c, ...m }) => m)
  }

  async listConversations(sessionId: string): Promise<StoredConversation[]> {
    const by = new Map<string, StoredConversation>()
    for (const r of await this.readMessages(sessionId)) {
      const cur = by.get(r.c)
      if (!cur) {
        by.set(r.c, {
          id: r.c,
          title: (r.role === 'user' ? r.content : 'Conversation').replace(/\s+/g, ' ').slice(0, 80),
          updatedAt: r.ts,
          count: 1,
        })
      } else {
        cur.count++
        cur.updatedAt = r.ts
        if (cur.title === 'Conversation' && r.role === 'user') cur.title = r.content.replace(/\s+/g, ' ').slice(0, 80)
      }
    }
    return [...by.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async deleteConversation(sessionId: string, conversationId: string): Promise<void> {
    const rows = await this.readMessages(sessionId)
    await this.writeMessages(sessionId, rows.filter((r) => r.c !== conversationId))
  }

  private async readNotes(sessionId: string): Promise<StoredNote[]> {
    try {
      return JSON.parse(await fs.promises.readFile(path.join(sessionDataDir(sessionId), 'notes.json'), 'utf8'))
    } catch {
      return []
    }
  }

  private async writeNotes(sessionId: string, notes: StoredNote[]) {
    const dir = sessionDataDir(sessionId)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, 'notes.json'), JSON.stringify(notes), 'utf8')
  }

  async addNote(sessionId: string, text: string): Promise<StoredNote> {
    const notes = await this.readNotes(sessionId)
    const next = notes.reduce((m, n) => Math.max(m, Number(n.id)), 0) + 1
    const note = { id: String(next), text, ts: new Date().toISOString() }
    notes.push(note)
    await this.writeNotes(sessionId, notes)
    return note
  }

  async listNotes(sessionId: string): Promise<StoredNote[]> {
    return this.readNotes(sessionId)
  }

  async scrubStatement(sessionId: string, text: string): Promise<number> {
    const rows = await this.readMessages(sessionId)
    const drop = new Set<number>()
    rows.forEach((r, i) => {
      if (r.role !== 'user' || r.content.slice(0, 1000) !== text) return
      drop.add(i)
      for (let j = i + 1; j < rows.length; j++) {
        if (rows[j].c !== r.c) continue
        if (rows[j].role === 'assistant') drop.add(j)
        break
      }
    })
    if (drop.size === 0) return 0
    await this.writeMessages(sessionId, rows.filter((_, i) => !drop.has(i)))
    return drop.size
  }

  async deleteNote(sessionId: string, noteId: string): Promise<boolean> {
    const notes = await this.readNotes(sessionId)
    const left = notes.filter((n) => n.id !== noteId)
    if (left.length === notes.length) return false
    await this.writeNotes(sessionId, left)
    return true
  }
}
