"use client"

import type { DocItem } from '@/lib/docs'
import FileUpload, { type UploadedDoc } from './FileUpload'
import DocList from './DocList'
import { LogoMark, PlusIcon } from './Icons'

export default function Sidebar({
  uploadedDocs,
  sessionId,
  onNewSession,
  onUploaded,
  onRemoveDoc,
  onRetryDoc,
}: {
  uploadedDocs: DocItem[]
  sessionId: string
  onNewSession: () => void
  onUploaded: (files: UploadedDoc[]) => void
  onRemoveDoc: (id: string) => void
  onRetryDoc: (doc: DocItem) => void
}) {
  return (
    <aside className="hidden lg:flex fixed left-0 top-0 h-dvh w-[320px] flex-col border-r border-[var(--border)] bg-[var(--surface)]/70 backdrop-blur-xl z-30">
      <div className="p-4 pb-3 flex items-center gap-3">
        <LogoMark className="w-9 h-9 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Smart Research</div>
          <div className="text-[11px] text-dim leading-tight">Assistant</div>
        </div>
      </div>

      <div className="px-4">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 rounded-xl gradient-bg text-white text-sm font-medium px-3 py-2.5 shadow-glow hover:brightness-110 active:scale-[0.98] transition"
        >
          <PlusIcon className="w-4 h-4" />
          New Session
        </button>
      </div>

      <div className="px-4 pt-4">
        <FileUpload compact sessionId={sessionId} onComplete={onUploaded} />
      </div>

      <div className="px-4 pt-5 pb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
          Documents
        </div>
        {uploadedDocs.length > 0 && (
          <div className="text-[10px] text-dim">{uploadedDocs.length}</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <DocList docs={uploadedDocs} onRemove={onRemoveDoc} onRetry={onRetryDoc} />
      </div>
    </aside>
  )
}
