import { ChatOpenAI } from '@langchain/openai'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { formatDocumentsAsString } from 'langchain/util/document'
import { getRetriever } from './retriever'
import { buildRagPrompt } from '@/utils/promptTemplates'

export async function runRagQuery(sessionId: string, query: string, onToken?: (t: string) => void) {
  let context = ''
  try {
    const retriever = await getRetriever(sessionId)
    // Retrieve relevant documents (best-effort)
    const docs = await retriever.getRelevantDocuments(query)
    context = formatDocumentsAsString(docs)
  } catch (err) {
    // If vector store missing or fails to load, proceed without context
    context = ''
  }
  
  const llm = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    streaming: Boolean(onToken),
    openAIApiKey: process.env.OPENAI_API_KEY,
  })

  const prompt = buildRagPrompt()
  
  if (onToken) {
    // Handle streaming response
    const chain = prompt.pipe(llm).pipe(new StringOutputParser())
    const stream = await chain.stream({ context, question: query })
    
    for await (const chunk of stream) {
      if (typeof chunk === 'string') {
        onToken(chunk)
      }
    }
  } else {
    // Non-streaming response
    const chain = prompt.pipe(llm).pipe(new StringOutputParser())
    const result = await chain.invoke({ context, question: query })
    return String(result)
  }
}

