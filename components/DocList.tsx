"use client"

import { motion, AnimatePresence } from 'framer-motion'
import type { DocItem } from '@/lib/docs'
import { FileIcon, TrashIcon, RetryIcon, SpinnerIcon, AlertIcon } from './Icons'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const STATUS_DOT: Record<DocItem['status'], string> = {
  ready: 'bg-emerald-400',
  indexing: 'bg-amber-400',
  error: 'bg-red-400',
}

const STATUS_LABEL: Record<DocItem['status'], string> = {
  ready: 'Indexed',
  indexing: 'Indexing…',
  error: 'Failed to index',
}

export default function DocList({
  docs,
  onRemove,
  onRetry,
}: {
  docs: DocItem[]
  onRemove: (id: string) => void
  onRetry: (doc: DocItem) => void
}) {
  if (docs.length === 0) {
    return <div className="text-xs text-dim px-1">No documents uploaded yet.</div>
  }
  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {docs.map((d) => (
          <motion.li
            key={d.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="group glass rounded-xl p-2.5 flex items-start gap-2.5"
          >
            <div className="mt-0.5 shrink-0 text-dim">
              <FileIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate" title={d.name}>
                {d.name}
              </div>
              <div className="text-[10px] text-dim flex items-center gap-1.5 mt-0.5">
                <motion.span
                  key={d.status}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[d.status]}`}
                />
                {d.status === 'indexing' ? (
                  <span className="flex items-center gap-1">
                    <SpinnerIcon className="w-3 h-3" /> Indexing…
                  </span>
                ) : (
                  <motion.span
                    key={`label-${d.status}`}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {STATUS_LABEL[d.status]}
                  </motion.span>
                )}
                <span aria-hidden>·</span>
                {formatSize(d.size)}
              </div>
              {d.status === 'indexing' && (
                <div className="mt-1.5 h-1 rounded-full bg-[var(--border)] overflow-hidden" aria-hidden>
                  <span className="shimmer-bar block h-full w-full" />
                </div>
              )}
              {d.status === 'error' && d.error && (
                <div className="text-[10px] text-red-400 mt-1 flex items-start gap-1">
                  <AlertIcon className="w-3 h-3 mt-px shrink-0" />
                  <span className="line-clamp-2">{d.error}</span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              {d.status === 'error' && (
                <button
                  onClick={() => onRetry(d)}
                  className="p-1 rounded-md text-dim hover:text-white hover:bg-white/10"
                  aria-label={`Retry indexing ${d.name}`}
                  title="Retry indexing"
                >
                  <RetryIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => onRemove(d.id)}
                className="p-1 rounded-md text-dim hover:text-red-300 hover:bg-white/10"
                aria-label={`Remove ${d.name}`}
                title="Remove document"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
