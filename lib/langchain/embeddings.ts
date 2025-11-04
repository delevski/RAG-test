import { OpenAIEmbeddings } from "@langchain/openai"

export function createEmbeddings() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is missing. Please add it to your .env.local file.')
  }
  
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  })
}

