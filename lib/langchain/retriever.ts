import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { FaissStore } from '@langchain/community/vectorstores/faiss'
import { Document } from '@langchain/core/documents'
import { createEmbeddings } from './embeddings'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { TextLoader } from 'langchain/document_loaders/fs/text'

// Use /tmp for serverless environments (AWS Lambda, Vercel, etc.)
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
const DATA_DIR = isServerless
  ? path.join('/tmp', '.data', 'faiss')
  : path.join(process.cwd(), '.data', 'faiss')

function ensureDir(p: string) {
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
  } catch (error: any) {
    // If creation fails and we're not in serverless, try /tmp as fallback
    if (!isServerless && !p.startsWith('/tmp')) {
      const tmpPath = p.replace(process.cwd(), '/tmp')
      try {
        if (!fs.existsSync(tmpPath)) {
          fs.mkdirSync(tmpPath, { recursive: true })
        }
        // Note: This changes the DATA_DIR, but we can't modify the const
        // The caller should handle this
      } catch (tmpError) {
        console.error('Failed to create directory:', error, tmpError)
        throw error
      }
    } else {
      console.error('Failed to create directory:', error)
      throw error
    }
  }
}

async function downloadToTemp(url: string, filenameHint?: string) {
  // If it's a local file URL, read from the file system
  if (url.startsWith('/api/files/')) {
    const filename = url.split('/').pop() || ''
    
    // Check both possible locations (serverless uses /tmp)
    const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION
    const uploadsDir = isServerless 
      ? path.join('/tmp', 'uploads')
      : path.join(process.cwd(), 'uploads')
    
    let filePath = path.join(uploadsDir, filename)
    
    // If file doesn't exist in primary location, try /tmp as fallback
    if (!fs.existsSync(filePath) && !isServerless) {
      const tmpPath = path.join('/tmp', 'uploads', filename)
      if (fs.existsSync(tmpPath)) {
        filePath = tmpPath
      }
    }
    
    if (fs.existsSync(filePath)) {
      // Return the path directly - no need to copy to temp
      return filePath
    }
    throw new Error(`Local file not found: ${filename}`)
  }
  
  // Otherwise, download from remote URL
  // For server-side, construct full URL if needed
  const fullUrl = url.startsWith('http') ? url : `http://localhost:${process.env.PORT || 3000}${url}`
  
  const res = await fetch(fullUrl)
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  const bytes = Buffer.from(arrayBuffer)
  const ext = (filenameHint?.split('.').pop() || url.split('?')[0].split('.').pop() || 'bin').toLowerCase()
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
  
  // Only delete temp files (not local uploaded files)
  if (!isLocalFile) {
    await fs.promises.unlink(filePath).catch(() => {})
  }
  return docs
}

export async function indexDocuments(sessionId: string, inputs: Array<{ url: string; name?: string }>) {
  ensureDir(DATA_DIR)
  const rawDocs: Document[] = []
  
  if (!inputs || inputs.length === 0) {
    throw new Error('No documents provided for indexing')
  }
  
  for (const d of inputs) {
    try {
      const docs = await loadDocumentsFromUrl(d.url, d.name)
      rawDocs.push(...docs)
    } catch (error: any) {
      console.error(`Failed to load document ${d.name || d.url}:`, error)
      throw new Error(`Failed to load document: ${error.message}`)
    }
  }
  
  if (rawDocs.length === 0) {
    throw new Error('No documents were successfully loaded')
  }
  
  const splitter = new RecursiveCharacterTextSplitter({ 
    chunkSize: 1200, 
    chunkOverlap: 150 
  })
  const chunks = await splitter.splitDocuments(rawDocs)
  
  if (chunks.length === 0) {
    throw new Error('No text chunks were created from documents')
  }
  
  const embeddings = createEmbeddings()
  
  // Use FAISS for local persistence - much simpler and works reliably
  const vectorStorePath = path.join(DATA_DIR, `session-${sessionId}`)
  ensureDir(vectorStorePath)
  
  // Create FAISS vector store from documents
  const vectorStore = await FaissStore.fromDocuments(chunks, embeddings)
  
  // Save to disk for persistence
  await vectorStore.save(vectorStorePath)
}

export async function getRetriever(sessionId: string) {
  ensureDir(DATA_DIR)
  const embeddings = createEmbeddings()
  
  const vectorStorePath = path.join(DATA_DIR, `session-${sessionId}`)
  
  if (!fs.existsSync(vectorStorePath)) {
    throw new Error(`Vector store for session ${sessionId} not found. Please upload and embed documents first.`)
  }
  
  try {
    // Load FAISS vector store from disk
    const vectorStore = await FaissStore.load(vectorStorePath, embeddings)
    return vectorStore.asRetriever({ k: 5 })
  } catch (error: any) {
    throw new Error(`Failed to load vector store for session ${sessionId}: ${error.message}`)
  }
}

