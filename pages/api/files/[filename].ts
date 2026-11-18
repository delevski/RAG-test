import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { assertValidSessionId, sessionUploadDir } from '@/lib/langchain/retriever'
import { getSessionStore } from '@/lib/store/sessionStore'
import { assertBrainAccess } from '@/lib/brain'

/**
 * Serves an uploaded file back to the OWNING session only. Both the session
 * id and the filename are validated, and the resolved path must stay inside
 * that session's upload directory: no cross-session reads, no traversal.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { filename, session } = req.query
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Invalid filename' })
  }
  try {
    assertValidSessionId(session)
  } catch {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }

  try {
    assertBrainAccess(req, session)
  } catch {
    await new Promise((r) => setTimeout(r, 600))
    return res.status(403).json({ error: 'Owner passphrase required' })
  }

  const uploadsDir = sessionUploadDir(session as string)
  const safeName = path.basename(filename)
  const filePath = path.join(uploadsDir, safeName)

  const resolvedPath = path.resolve(filePath)
  const resolvedDir = path.resolve(uploadsDir)
  if (resolvedPath !== path.join(resolvedDir, safeName)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  let fileBuffer: Buffer
  if (fs.existsSync(resolvedPath)) {
    fileBuffer = fs.readFileSync(resolvedPath)
  } else {
    // Cold start wiped the local copy; try the durable store.
    const store = await getSessionStore()
    const restored = await store.getFile(session as string, safeName)
    if (!restored) {
      return res.status(404).json({ error: 'File not found' })
    }
    fileBuffer = restored
  }
  const ext = path.extname(safeName).toLowerCase()

  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
  }

  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
  res.send(fileBuffer)
}
