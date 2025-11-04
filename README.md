# Smart Research Assistant (RAG)

Production-grade RAG web app built with Next.js + TypeScript + TailwindCSS + LangChain + OpenAI + Firebase Storage. Drag & drop documents, embed to Chroma, and chat with GPT using retrieved context.

## Tech Stack
- Next.js 14 (Pages API for server routes, App Router for UI)
- TypeScript, TailwindCSS, Framer Motion
- LangChain (OpenAI Embeddings `text-embedding-3-small`, Chroma vector store)
- OpenAI Chat (default `gpt-4o-mini` configurable)
- Firebase Storage (client SDK upload)

## Project Structure
```
/app
  layout.tsx, page.tsx, globals.css
/components
  ChatInterface.tsx, FileUpload.tsx, Sidebar.tsx
/lib
  /firebase: initFirebase.ts, uploadToFirebase.ts
  /langchain: embeddings.ts, retriever.ts, ragChain.ts
/pages/api
  embed.ts, query.ts, upload.ts
/utils
  promptTemplates.ts
```

## Setup
1) Install deps
```bash
npm install
```

2) Create `.env.local` at repo root with:
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

OPENAI_API_KEY=
# Optional override
OPENAI_MODEL=gpt-4o-mini
```

3) Firebase
- Create a Firebase project and enable Storage.
- Configure storage rules to allow authenticated or public uploads as needed.
- The app uploads directly from browser via Firebase client SDK.

4) Development
```bash
npm run dev
```
Open http://localhost:3000

## How It Works
- Upload: Client uploads PDF/DOCX/TXT to Firebase Storage and obtains a public URL
- Embed: POST `/api/embed` with `{ sessionId, docs: [{ url, name }] }`. Server downloads, loads via LangChain loaders, splits, embeds with OpenAI, persists to Chroma (local `.data/chroma`).
- Query: POST `/api/query` with `{ sessionId, query }`. Retrieves top-k chunks, constructs prompt, streams OpenAI answer to client.

## Notes
- Chroma persistence uses local directory `.data/chroma`. For serverless deploys, use a managed vector DB or Chroma server instead.
- `/api/upload` is a placeholder; uploads happen client-side. To move uploads to server, integrate Firebase Admin SDK.
- Ensure the machine running the API has write access to `.data`.
- ChromaDB requires SQLite for local persistence. The `chromadb` package handles this automatically.
- Document loaders require `pdf-parse` for PDFs and `mammoth` for DOCX files - these are included in dependencies.

## Skills Inspiration
Prompting and retrieval design is influenced by community skills that structure research, summarization, and validation patterns. See: `https://github.com/abubakarsiddik31/claude-skills-collection?tab=readme-ov-file#what-are-claude-skills`

## Security
- Keep `OPENAI_API_KEY` on the server only.
- Firebase client keys are public, but respect Storage rules.
- Validate and sanitize file sources if enabling arbitrary URLs.

## License
MIT
