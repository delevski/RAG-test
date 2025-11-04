"use client"

import { useCallback, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { uploadToLocal } from '@/lib/storage/uploadLocal'

type UploadedDoc = { name: string; url: string; size: number; type: string }

export default function FileUpload({ onComplete }: { onComplete: (files: UploadedDoc[]) => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false if we're leaving the drop zone itself
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    setError(null)
    
    const files = Array.from(e.dataTransfer.files).filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      return ['pdf', 'doc', 'docx', 'txt'].includes(ext || '')
    })
    
    if (files.length === 0) {
      setError('Please upload PDF, DOCX, or TXT files only')
      return
    }

    setUploading(true)
    const uploaded: UploadedDoc[] = []
    
    for (const file of files) {
      try {
        const { url } = await uploadToLocal(file, (p) => setProgress(p))
        uploaded.push({ name: file.name, url, size: file.size, type: file.type })
      } catch (err: any) {
        setError(err?.message ?? `Failed to upload ${file.name}`)
      } finally {
        setProgress(null)
      }
    }
    
    setUploading(false)
    if (uploaded.length) onComplete(uploaded)
  }, [onComplete])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    setError(null)
    setUploading(true)
    
    const files = Array.from(e.target.files)
    const uploaded: UploadedDoc[] = []
    
    for (const file of files) {
      try {
        const { url } = await uploadToLocal(file, (p) => setProgress(p))
        uploaded.push({ name: file.name, url, size: file.size, type: file.type })
      } catch (err: any) {
        setError(err?.message ?? `Failed to upload ${file.name}`)
      } finally {
        setProgress(null)
      }
    }
    
    setUploading(false)
    if (uploaded.length) onComplete(uploaded)
    if (e.currentTarget) {
      e.currentTarget.value = ''
    }
  }, [onComplete])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
        accept=".pdf,.doc,.docx,.txt"
      />
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all duration-200
          ${isDragging 
            ? 'border-primary bg-primary/10 scale-105' 
            : 'border-[var(--border)] bg-[var(--surface)] hover:border-primary/50 hover:bg-[var(--surface)]/80'
          }
          ${uploading ? 'pointer-events-none opacity-75' : ''}
        `}
      >
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className={`text-4xl ${isDragging ? 'scale-110' : ''} transition-transform`}>
            📄
          </div>
          <div>
            <p className="text-sm font-medium text-gray-200 mb-1">
              {isDragging ? 'Drop files here' : 'Drop files here or click to browse'}
            </p>
            <p className="text-xs text-gray-400">
              Supports PDF, DOCX, and TXT files
            </p>
          </div>
          {progress !== null && (
            <div className="w-full max-w-xs">
              <div className="w-full bg-[var(--border)] h-2 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full bg-primary rounded-full"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">{progress}%</p>
            </div>
          )}
        </div>
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-2 left-0 right-0 text-center"
            >
              <p className="text-xs text-red-400 bg-red-900/20 px-3 py-1 rounded">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

