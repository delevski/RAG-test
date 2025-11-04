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

  // Check both possible locations (serverless uses /tmp)
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
  const uploadsDir = isServerless 
    ? path.join('/tmp', 'uploads')
    : path.join(process.cwd(), 'uploads')
  
  const filePath = path.join(uploadsDir, filename)

  // Security check - ensure path is within allowed directory
  const resolvedPath = path.resolve(filePath)
  const resolvedDir = path.resolve(uploadsDir)
  if (!resolvedPath.startsWith(resolvedDir)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // If file doesn't exist in primary location, try /tmp as fallback
  let finalPath = filePath
  if (!fs.existsSync(filePath) && !isServerless) {
    const tmpPath = path.join('/tmp', 'uploads', filename)
    if (fs.existsSync(tmpPath)) {
      finalPath = tmpPath
    }
  }

  if (!fs.existsSync(finalPath)) {
    return res.status(404).json({ error: 'File not found' })
  }

  const fileBuffer = fs.readFileSync(finalPath)
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

