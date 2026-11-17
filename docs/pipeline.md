# Pipeline

```
┌─────────┐   upload (multipart, session-scoped, validated)   ┌───────────────┐
│ Browser │ ─────────────────────────────────> │  /api/upload  │
└─────────┘                                    └──────┬────────┘
     │                                                │ per-session dir
     │ POST /api/embed { sessionId, docs }            ▼
     │ ┌────────────────────────────────────────────────────────┐
     │ │ load (pdf-parse / mammoth / text) → split (1200/150)   │
     └>│ → embed (OpenAI text-embedding-3-small)                │
       │ → JsonVectorStore.save(/tmp/.data/vectors/session-*)   │
       └───────────────────────────┬────────────────────────────┘
                                   │
     │ POST /api/query { sessionId, query, expectContext }
     │ ┌───────────────────────────▼────────────────────────────┐
     │ │ top-5 cosine similarity → prompt(context, question)    │
     │ │ → LLM stream (gpt-4o-mini)                             │
     └>│ → text … \n\n__SOURCES__[{name, snippet}]               │
       └────────────────────────────────────────────────────────┘
```

- Citations come only from chunks actually retrieved server-side.
- `RAG_MOCK=1` swaps the provider for deterministic local embeddings and a
  canned stream: the identical pipeline runs with no API key and no cost.
- On serverless, `/tmp` is per-instance and ephemeral; a missing index
  surfaces as `409 INDEX_MISSING` and is re-built only on explicit user
  action (re-embedding costs API calls).
