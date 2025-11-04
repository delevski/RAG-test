"use client"

import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from '@/components/Sidebar'
import FileUpload from '@/components/FileUpload'
import ChatInterface from '@/components/ChatInterface'
import Loader from '@/components/Loader'

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [uploadedDocs, setUploadedDocs] = useState<Array<{ name: string; url: string; size: number; type: string }>>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate initial load time for smooth UX
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 1200) // 1.2 seconds - enough to show the loader, not too long

    return () => clearTimeout(timer)
  }, [])

  const handleNewSession = () => {
    setSessionId(crypto.randomUUID())
    setUploadedDocs([])
  }

  return (
    <>
      <AnimatePresence>
        {isLoading && <Loader />}
      </AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isLoading ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        className="grid lg:grid-cols-[300px_1fr] h-dvh"
      >
        <Sidebar
          uploadedDocs={uploadedDocs}
          onNewSession={handleNewSession}
        />
        <main className="relative h-full flex flex-col">
          <div className="sticky top-0 z-10 glass p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-lg font-semibold">Smart Research Assistant</h1>
            </div>
            <FileUpload onComplete={(docs) => setUploadedDocs((prev) => [...prev, ...docs])} />
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatInterface sessionId={sessionId} uploadedDocs={uploadedDocs} />
          </div>
        </main>
      </motion.div>
    </>
  )
}

