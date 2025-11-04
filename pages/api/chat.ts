import type { NextApiRequest, NextApiResponse } from 'next'
import { ChatOpenAI } from '@langchain/openai'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatPromptTemplate } from '@langchain/core/prompts'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed')
  const { query } = req.body as { query: string }
  if (!query) return res.status(400).end('Missing query')

  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).end('OPENAI_API_KEY is missing')
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')

  try {
    const llm = new ChatOpenAI({
      modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      streaming: true,
      openAIApiKey: process.env.OPENAI_API_KEY,
    })

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful AI assistant. Be concise, friendly, and helpful.'],
      ['human', '{query}'],
    ])

    const chain = prompt.pipe(llm).pipe(new StringOutputParser())
    const stream = await chain.stream({ query })

    for await (const chunk of stream) {
      if (typeof chunk === 'string') {
        res.write(chunk)
      }
    }
    res.end()
  } catch (err: any) {
    console.error('chat error', err)
    res.status(500).end(err?.message ?? 'Internal error')
  }
}

