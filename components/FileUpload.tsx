"use client"

import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { uploadToLocal } from '@/lib/storage/uploadLocal'
import { UploadIcon, AlertIcon } from './Icons'

export type UploadedDoc = { name: string; url: string; size: number; type: string }

const ACCEPTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB; matches the server limit

export default function FileUpload({
  onComplete,
  compact = false,
}: {
  onComplete: (files: UploadedDoc[]) => void
  compact?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = useCallback(
    async (candidates: File[]) => {
      setError(null)
      const files = candidates.filter((file) => {
        const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
        return ACCEPTED_EXTENSIONS.includes(ext)
      })
      if (files.length === 0) {
        setError('Please upload PDF, DOCX, or TXT files only')
        return
      }
      const oversized = files.find((f) => f.size > MAX_FILE_SIZE)
      if (oversized) {
        setError(`"${oversized.name}" is too large. Maximum size is 10MB.`)
        return
      }

      setUploading(true)
      const uploaded: UploadedDoc[] = []
      for (const file of files) {
        try {
          setCurrentFile(file.name)
          const { url } = await uploadToLocal(file, (p) => setProgress(p))
          uploaded.push({ name: file.name, url, size: file.size, type: file.type })
        } catch (err: any) {
          setError(err?.message ?? `Failed to upload ${file.name}`)
        } finally {
          setProgress(null)
          setCurrentFile(null)
        }
      }
      setUploading(false)
      if (uploaded.length) onComplete(uploaded)
    },
    [onComplete]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      await uploadFiles(Array.from(e.dataTransfer.files))
    },
    [uploadFiles]
  )

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return
      await uploadFiles(Array.from(e.target.files))
      e.target.value = ''
    },
    [uploadFiles]
  )

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
        accept={ACCEPTED_EXTENSIONS.join(',')}
      />
      <div
        role="button"
        tabIndex={0}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragging(false)
        }}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (!uploading) fileInputRef.current?.click()
          }
        }}
        className={`
          relative border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200
          ${compact ? 'p-4' : 'p-8'}
          ${
            isDragging
              ? 'border-primary bg-primary/10 scale-[1.02]'
              : 'border-[var(--border)] bg-[var(--surface-2)]/50 hover:border-primary/50 hover:bg-[var(--surface-2)]'
          }
          ${uploading ? 'pointer-events-none opacity-80' : ''}
        `}
      >
        <div className="flex flex-col items-center justify-center gap-2.5 text-center">
          <div
            className={`rounded-xl gradient-bg text-white flex items-center justify-center shadow-glow transition-transform ${
              compact ? 'w-9 h-9' : 'w-11 h-11'
            } ${isDragging ? 'scale-110' : ''}`}
          >
            <UploadIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
          </div>
          <div>
            <p className={`font-medium text-gray-100 ${compact ? 'text-xs' : 'text-sm'}`}>
              {isDragging ? 'Drop files here' : 'Drop files here or click to browse'}
            </p>
            <p className="text-xs text-dim mt-0.5">Supports PDF, DOCX, and TXT files</p>
          </div>
          {progress !== null && (
            <div className="w-full max-w-[200px]">
              <div className="w-full bg-[var(--border)] h-1.5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full gradient-bg rounded-full"
                />
              </div>
              <p className="text-[10px] text-dim mt-1 truncate">
                {currentFile} — {progress}%
              </p>
            </div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 flex items-start gap-1.5 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
          >
            <AlertIcon className="w-3.5 h-3.5 mt-px shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
