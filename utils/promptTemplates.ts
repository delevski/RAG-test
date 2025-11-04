import { ChatPromptTemplate } from '@langchain/core/prompts'

// Inspired by structured prompting and summarization best practices; can be extended with Claude skills ideas
export function buildRagPrompt() {
  return ChatPromptTemplate.fromMessages([
    [
      'system',
      [
        'You are a precise, concise research assistant. Answer using ONLY the provided context if relevant.',
        'If the answer is not in the context, say you do not have enough information.',
        'When lists are appropriate, format them clearly. Cite relevant document snippets briefly when helpful.',
      ].join('\n')
    ],
    [
      'human',
      [
        'Question: {question}',
        '',
        'Context:',
        '{context}',
      ].join('\n')
    ]
  ])
}

