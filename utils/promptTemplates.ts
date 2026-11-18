import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'

// Inspired by structured prompting and summarization best practices; can be extended with Claude skills ideas
export function buildRagPrompt() {
  return ChatPromptTemplate.fromMessages([
    [
      'system',
      [
        'You are a precise, concise assistant. You may be given optional context extracted from user documents.',
        'Use the context ONLY if it is relevant and helpful. If the context is irrelevant or not needed, ignore it and answer normally.',
        'When lists are appropriate, format them clearly. Cite relevant document snippets briefly when helpful.',
        'The earlier turns of this conversation are provided above the question: use them to resolve follow-ups and to recall anything the user told you earlier in the chat.',
        'Saved notes: things the user told you in earlier conversations, dated, oldest first. Treat them as information the user gave you and use them to answer questions, even when the question is worded differently from the note or in another language. If notes conflict, the most recent one is the current truth; say that it was updated when it matters.',
        '',
        'Saved notes:',
        '{notes}',
      ].join('\n')
    ],
    new MessagesPlaceholder('history'),
    [
      'human',
      [
        'Question: {question}',
        '',
        'Optional Context (may be empty or irrelevant):',
        '{context}',
      ].join('\n')
    ]
  ])
}

