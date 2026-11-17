# Smart Research Assistant (RAG)

Upload documents, ask questions, get streamed answers **grounded in your sources** — with citations that point at the exact retrieved chunks.

A full-stack retrieval-augmented generation app: Next.js 14 + TypeScript + TailwindCSS + LangChain + OpenAI, with a dependency-free vector store and a mock provider that runs the whole pipeline in CI with zero API calls.

![Pipeline](docs/pipeline.md)

## What it does

- **Document chat** — drop PDF / DOCX / TXT files; they're parsed, split, embedded and indexed per session. Answers retrieve the most relevant chunks and cite them.
- **Plain chat** — no documents? The same interface falls back to a general assistant.
- **Honest UX** — per-document indexing status, explicit re-index after a serverless cold start (re-embedding costs API calls, so it never happens silently), stop / retry / copy, streamed responses with markdown rendering.
- **Mobile-first** — desktop sidebar becomes a bottom-navigation (Chat / Files) on small screens.

## Tech stack & key decisions

| Area | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 14 (App Router UI, Pages API routes) | Hybrid: React Server/Client Components for UI, classic API routes with raw `res.write` streaming |
| Retrieval | LangChain document loaders + `RecursiveCharacterTextSplitter` | Battle-tested parsing (pdf-parse, mammoth) and splitting |
| Vector store | **Custom `JsonVectorStore`** (pure TS, cosine similarity, JSON persistence) | Replaced `faiss-node`: a native module that is fragile on serverless. Zero native deps, predictable installs, trivially auditable |
| Embeddings / chat | OpenAI (`text-embedding-3-small`, `gpt-4o-mini` by default) | Cheap, good quality, key stays server-side |
| Mock provider | `RAG_MOCK=1` deterministic embeddings + canned stream | The full pipeline runs in CI and offline with **no paid calls** |
| Styling | TailwindCSS + custom design tokens, Inter | Dark, token-driven design system |
| Animation | framer-motion | Message/list transitions |

### Architecture

```
Browser ──upload──> /api/upload ──> /tmp|uploads/ (validated: type, size)
   │                                     │
   │            /api/embed ──────────────┤ load → split → embed
   │                  │                  ▼
   │                  │          JsonVectorStore (per session, JSON on disk)
   │                  │                  │
   └──chat────────> /api/query ──────────┘ top-k cosine similarity
                          │
                          ▼
             prompt(context, question) → LLM (streamed)
                          │
                          ▼
        answer text … \n\n__SOURCES__[{name, snippet}]
```

**Citations are bound to the chunks actually retrieved server-side**, appended as a single trailer chunk after the answer stream — never model-invented.

### Known limits (by design, documented honestly)

- **Ephemeral index on serverless.** The store persists to `/tmp`, which a cold start wipes. The app detects this (`INDEX_MISSING`), tells the user, and re-indexes only on explicit request. For durable multi-instance storage the upgrade path is a managed vector DB (e.g. Supabase pgvector — free tier) keyed by the same session id.
- **Upload size.** 10MB app limit; Vercel's platform request limit (4.5MB) applies first on that host.
- **Session scope.** Sessions are client-generated IDs; each session's index is isolated (validated IDs, per-session directories). There is no cross-session retrieval.

## Testing

```bash
npm test              # UI smoke + mobile suites (chat tests need OPENAI_API_KEY)
npm run test:mock     # full pipeline E2E, mock provider, no key needed
npm run lint
npm run build
```

## Setup

```bash
npm install --legacy-peer-deps
```

Create `.env.local`:

```
OPENAI_API_KEY=sk-...
# Optional overrides
OPENAI_MODEL=gpt-4o-mini
# RAG_MOCK=1   # run fully offline with the mock provider
```

```bash
npm run dev
```

## API

| Route | Method | Body | Notes |
| --- | --- | --- | --- |
| `/api/upload` | POST | multipart `file` | Validates extension + size server-side |
| `/api/embed` | POST | `{ sessionId, docs: [{url, name}] }` | Idempotent per session manifest — retries never double-embed |
| `/api/query` | POST | `{ sessionId, query, expectContext }` | Streams text; `__SOURCES__` trailer with citations; `409 INDEX_MISSING` when the index was lost |
| `/api/files/[filename]` | GET | — | Serves uploaded files (path-traversal guarded) |
| `/api/health` | GET | — | Liveness probe |

Session bounds: ≤10 documents, ≤1500 chunks, ≤4000-char queries per session.

## Deployment

- **Vercel**: connect the repo, set `OPENAI_API_KEY`, deploy. (See limits above.)
- **Docker**: `docker-compose up --build` — persistent `./uploads` and `./.data` volumes make the index durable there.
- CI (`.github/workflows/deploy.yml`): lint → Playwright (real + mock pipelines) → build.

## License

MIT
