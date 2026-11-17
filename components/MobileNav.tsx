"use client"

import { ChatIcon, FileIcon } from './Icons'

export type MobileTab = 'chat' | 'files'

export default function MobileNav({
  tab,
  onChange,
  docCount,
}: {
  tab: MobileTab
  onChange: (tab: MobileTab) => void
  docCount: number
}) {
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-2">
        <button
          onClick={() => onChange('chat')}
          aria-current={tab === 'chat' ? 'page' : undefined}
          className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
            tab === 'chat' ? 'text-white' : 'text-dim'
          }`}
        >
          <ChatIcon className={`w-5 h-5 ${tab === 'chat' ? 'text-primary' : ''}`} />
          Chat
        </button>
        <button
          onClick={() => onChange('files')}
          aria-current={tab === 'files' ? 'page' : undefined}
          className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
            tab === 'files' ? 'text-white' : 'text-dim'
          }`}
        >
          <span className="relative">
            <FileIcon className={`w-5 h-5 ${tab === 'files' ? 'text-primary' : ''}`} />
            {docCount > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full gradient-bg text-white text-[9px] font-semibold flex items-center justify-center">
                {docCount}
              </span>
            )}
          </span>
          Files
        </button>
      </div>
    </nav>
  )
}
