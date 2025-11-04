import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const uploadDir = path.join(process.cwd(), 'uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    // Disable default body parsing for formidable
    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      multiples: true,
    })

    // Parse the form - formidable v3 returns a promise
    const parsed = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err)
        else resolve([fields, files])
      })
    })
    const fields = parsed[0]
    const files = parsed[1]

    const file = Array.isArray(files.file) ? files.file[0] : files.file

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Handle both old and new formidable API
    const filepath = (file as any).filepath || (file as any).path || ''
    const originalFilename = (file as any).originalFilename || (file as any).name || 'file'
    const size = (file as any).size || 0
    const mimetype = (file as any).mimetype || (file as any).type || 'application/octet-stream'

    if (!filepath) {
      return res.status(400).json({ error: 'Invalid file upload' })
    }

    const timestamp = Date.now()
    const ext = path.extname(originalFilename)
    const baseName = path.basename(originalFilename, ext)
    // Sanitize filename
    const sanitizedBase = baseName.replace(/[^a-zA-Z0-9-_]/g, '_')
    const newFileName = `${timestamp}-${sanitizedBase}${ext}`
    const newPath = path.join(uploadDir, newFileName)

    // Move file to final location
    if (fs.existsSync(filepath)) {
      fs.renameSync(filepath, newPath)
    } else {
      return res.status(500).json({ error: 'File was not saved correctly' })
    }

    const url = `/api/files/${newFileName}`

    res.status(200).json({
      url,
      path: newPath,
      name: originalFilename,
      size,
      type: mimetype,
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    console.error('Error stack:', error.stack)
    res.status(500).json({ 
      error: error.message || 'Upload failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
