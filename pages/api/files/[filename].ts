import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { filename } = req.query
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filePath = path.join(process.cwd(), 'uploads', filename)

  if (!filePath.startsWith(path.join(process.cwd(), 'uploads'))) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' })
  }

  const fileBuffer = fs.readFileSync(filePath)
  const ext = path.extname(filename).toLowerCase()
  
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
  }

  res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  res.send(fileBuffer)
}

