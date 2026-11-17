"use client"

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

/**
 * Real-time waiting indicator. Every phase maps to something the client
 * actually knows - never a fabricated "reasoning" stage or fake timer:
 *   awaiting-index:  an upload is still being embedded (we await it)
 *   connecting-docs: request sent with indexed documents in play
 *   connecting-chat: request sent on the plain chat path (no sources claimed)
 */
export type ThinkingPhase = 'awaiting-index' | 'connecting-docs' | 'connecting-chat'

const LABELS: Record<ThinkingPhase, string> = {
  'awaiting-index': 'Waiting for your documents to finish indexing…',
  'connecting-docs': 'Searching your documents and thinking…',
  'connecting-chat': 'Thinking…',
}

export default function ThinkingIndicator({ phase }: { phase: ThinkingPhase }) {
  const reduce = useReducedMotion()
  return (
    <div className="flex items-center gap-3 py-1.5" role="status" aria-live="polite">
      <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
        {/* gradient core */}
        <motion.span
          className="absolute inset-1 rounded-full bg-gradient-to-tr from-indigo-500 via-violet-500 to-cyan-400"
          animate={reduce ? {} : { scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* orbiting satellite */}
        {!reduce && (
          <motion.span
            className="absolute inset-0"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          >
            <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
          </motion.span>
        )}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="text-xs text-dim"
        >
          {LABELS[phase]}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}
