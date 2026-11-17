export type DocStatus = 'indexing' | 'ready' | 'error'

export type DocItem = {
  id: string
  name: string
  url: string
  size: number
  type: string
  status: DocStatus
  error?: string
}

export type Citation = {
  name: string
  snippet: string
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: Citation[]
  failed?: boolean
}

export const SOURCES_DELIMITER = '\n\n__SOURCES__'
