"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string }

export default function ChatInterface({ sessionId, uploadedDocs }: { sessionId: string; uploadedDocs: Array<{ name: string; url: string }> }) {
  const hasDocs = useMemo(() => uploadedDocs.length > 0, [uploadedDocs])
  const [messages, setMessages] = useState<Message[]>(() => [{
    id: crypto.randomUUID(),
    role: 'system',
    content: hasDocs 
      ? 'What exactly would you like to research or learn from these documents?'
      : 'Hello! I can help you with questions or chat. Upload documents to enable research mode, or just ask me anything!'
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Update system message when documents are added/removed
  useEffect(() => {
    setMessages((prev) => {
      const firstMsg = prev[0]
      if (firstMsg?.role === 'system') {
        const newContent = hasDocs 
          ? 'What exactly would you like to research or learn from these documents?'
          : 'Hello! I can help you with questions or chat. Upload documents to enable research mode, or just ask me anything!'
        if (firstMsg.content !== newContent) {
          return [{ ...firstMsg, content: newContent }, ...prev.slice(1)]
        }
      }
      return prev
    })
  }, [hasDocs])

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isLoading])

  async function ensureEmbedded() {
    if (!hasDocs) {
      return false // No documents, use regular chat
    }
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, docs: uploadedDocs })
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Failed to embed documents' }))
      const errorMsg = error.message || error.error || 'Failed to process documents'
      throw new Error(errorMsg)
    }
    return true // Documents embedded, use RAG
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: input.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setIsLoading(true)
    try {
      const useRag = await ensureEmbedded().catch(() => false)
      
      // Use RAG endpoint if documents are available, otherwise use regular chat
      const endpoint = useRag ? '/api/query' : '/api/chat'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, query: userMsg.content })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || `Server error: ${res.status}`)
      }
      
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream available')
      
      const decoder = new TextDecoder()
      let assistantMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '' }
      setMessages((m) => [...m, assistantMsg])
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        assistantMsg = { ...assistantMsg, content: assistantMsg.content + chunk }
        setMessages((m) => m.map((x) => x.id === assistantMsg.id ? assistantMsg : x))
      }
    } catch (err: any) {
      const assistantMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${err?.message ?? 'Unknown error'}` }
      setMessages((m) => [...m, assistantMsg])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      <div 
        ref={scrollRef} 
        className="flex-1 overflow-y-auto p-4 space-y-4"
        style={{ paddingBottom: '100px' }}
      >
        {messages.map((m) => (
          <div key={m.id} className={`max-w-3xl ${m.role === 'user' ? 'ml-auto' : ''}`}>
            <div className={`rounded-lg p-3 border ${m.role === 'user' ? 'bg-primary/20 border-[var(--border)]' : 'glass'}`}>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-xs text-gray-400">Thinking…</div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form 
        onSubmit={sendMessage} 
        className="absolute bottom-0 left-0 right-0 p-3 border-t border-[var(--border)] bg-[var(--surface)] z-20"
      >
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={hasDocs ? "Ask a question about your documents…" : "Ask me anything or chat…"}
            className="flex-1 rounded-md bg-transparent border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button disabled={isLoading || !input.trim()} className="px-3 py-2 rounded-md bg-primary text-white text-sm disabled:opacity-50">Send</button>
        </div>
      </form>
    </div>
  )
}

