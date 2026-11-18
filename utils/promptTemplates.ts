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
        'Context chunks labelled "Conversation memory" are saved notes from earlier conversations with the same user: treat what the user said there as information they gave you.',
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

