import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

export const config = {
  api: {
    bodyParser: false,
  },
}

// Server-side validation — the client checks too, but never trust the client.
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt'])
// Note: serverless platforms cap request bodies well below this
// (Vercel: 4.5 MB), which is a platform limit, not an app limit.
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const isServerless =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION

    let uploadDir = isServerless
      ? path.join('/tmp', 'uploads')
      : path.join(process.cwd(), 'uploads')

    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }
    } catch (mkdirError: any) {
      if (!isServerless && uploadDir !== path.join('/tmp', 'uploads')) {
        const tmpUploadDir = path.join('/tmp', 'uploads')
        try {
          if (!fs.existsSync(tmpUploadDir)) {
            fs.mkdirSync(tmpUploadDir, { recursive: true })
          }
          uploadDir = tmpUploadDir
        } catch (tmpError) {
          console.error('Failed to create upload directories:', mkdirError, tmpError)
          return res.status(500).json({
            error: 'Failed to initialize upload directory',
            message: 'Server configuration issue. Please contact support.',
          })
        }
      } else {
        console.error('Failed to create upload directory:', mkdirError)
        return res.status(500).json({
          error: 'Failed to initialize upload directory',
          message: 'Server configuration issue. Please contact support.',
        })
      }
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      multiples: false,
    })

    const parsed = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err)
        else resolve([fields, files])
      })
    })
    const files = parsed[1]

    const file = Array.isArray(files.file) ? files.file[0] : files.file
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const filepath = (file as any).filepath || (file as any).path || ''
    const originalFilename = (file as any).originalFilename || (file as any).name || 'file'
    const size = (file as any).size || 0
    const mimetype = (file as any).mimetype || (file as any).type || 'application/octet-stream'

    if (!filepath) {
      return res.status(400).json({ error: 'Invalid file upload' })
    }

    const ext = path.extname(originalFilename).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      fs.existsSync(filepath) && fs.unlinkSync(filepath)
      return res.status(400).json({
        error: `Unsupported file type "${ext || 'unknown'}". Please upload PDF, DOCX, or TXT files.`,
      })
    }
    if (size > MAX_FILE_SIZE) {
      fs.existsSync(filepath) && fs.unlinkSync(filepath)
      return res.status(400).json({
        error: `File is too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
      })
    }

    const timestamp = Date.now()
    const baseName = path.basename(originalFilename, ext)
    const sanitizedBase = baseName.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80)
    const newFileName = `${timestamp}-${sanitizedBase}${ext}`
    const newPath = path.join(uploadDir, newFileName)

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
    if (error?.code === 1009 || error?.message?.includes('maxFileSize')) {
      return res.status(400).json({
        error: `File is too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
      })
    }
    res.status(500).json({
      error: error.message || 'Upload failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    })
  }
}
