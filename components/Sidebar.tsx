"use client"

type Doc = { name: string; url: string; size: number; type: string }

export default function Sidebar({ uploadedDocs, onNewSession }: { uploadedDocs: Doc[]; onNewSession: () => void }) {
  return (
    <aside className="fixed left-0 top-0 h-dvh w-[300px] border-r border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col z-30 hidden lg:flex">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Documents</div>
        <button
          className="text-xs px-2 py-1 rounded bg-primary/20 hover:bg-primary/30 border border-[var(--border)]"
          onClick={onNewSession}
        >New Session</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {uploadedDocs.length === 0 && (
          <div className="text-xs text-gray-400">No documents uploaded yet.</div>
        )}
        {uploadedDocs.map((d) => (
          <div key={d.url} className="block glass rounded p-2 hover:bg-white/5">
            <div className="text-xs font-medium truncate">{d.name}</div>
            <div className="text-[10px] text-gray-400">{(d.size/1024).toFixed(1)} KB • {d.type || 'file'}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

