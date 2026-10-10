# Egyptian Tour Guide — Agentic RAG Chatbot

[![CI](https://github.com/mahmoudhaytham25/egyptian-tour-guide-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/mahmoudhaytham25/egyptian-tour-guide-rag/actions/workflows/ci.yml)

A full-stack agentic chatbot for Egyptian tourism. It answers questions grounded in uploaded Egyptian history documents via a Retrieval-Augmented Generation (RAG) pipeline, holds natural multi-turn conversations, and can plan trip schedules (e.g. "a Thursday itinerary in Luxor").

## Features

- **Document-grounded Q&A** — upload Egyptian history PDFs (1000+ pages supported), index them, and ask questions; answers cite source document pages
- **Conversational agent** — classifies incoming prompts as RAG queries vs. casual conversation and responds accordingly, with query enhancement for follow-ups ("When did *he* rule Egypt?")
- **Trip scheduling** — generates day itineraries using a curated monuments dataset (locations, opening times)
- **User accounts** — JWT auth with email verification, isolated per-user conversations, persistent chat history in MongoDB
- **Document management UI** — upload, index, and track indexing status from the React frontend

## Screenshots

| Home | Chat |
|---|---|
| ![Homepage](screenshots/home.png) | ![Chat Interface](screenshots/chat.png) |

## Architecture

```
frontend/          React SPA (port 3000) — chat UI, document management, auth
     │
backend/           Express API (port 3001) — JWT auth, conversations, RAG endpoints
     │                              └─ calls model-server /query + /index over HTTP
model-server/      Flask model services (port 5050) + RAG pipeline
                   ├─ rag/          classifier, indexer, retriever, generator
                   ├─ models/       Gemini 3.8 Flash LLM + Gemini embeddings (gemini-embedding-001)
                   ├─ data/         uploaded PDFs (incl. bundled egyptian_history.pdf)
                   └─ times_places/ monument dataset for trip scheduling

MongoDB            users, conversations, chat history
```

## Stack

Python (Flask, PyMuPDF) · Node.js (Express) · React · MongoDB · Google Gemini 3.8 Flash + gemini-embedding-001 · JWT

## Getting Started

### Run with Docker (recommended)

The whole stack — frontend, backend, model server, and MongoDB — runs with one command:

```
cp .env.example .env   # then set GEMINI_API_KEY inside .env
docker compose up --build
```

Then open http://localhost:3000.

- **`GEMINI_API_KEY`** is required by the model server — get one at [Google AI Studio](https://aistudio.google.com/app/apikey).
- **`JWT_SECRET`** is optional; compose falls back to a dev-only value. Set a long random string for real deployments.
- `GEMINI_API_KEY` is required for indexing AND querying — embeddings run through the Gemini API too (`gemini-embedding-001`), so there is no model download and first start is fast. If you previously indexed with the old local model, re-index: the new embeddings are incompatible with old vector files.
- Named volumes keep MongoDB data, uploaded PDFs (`rag-data`, seeded with `data/egyptian_history.pdf`), and the generated vector index (`vector-store`) persistent across restarts. Upload a PDF + index it once (Documents UI) or re-index the bundled PDF after a fresh `up`.
- **Free-tier quota caveat:** on a free Google AI Studio key, generation (`gemini-3.8-flash`) is limited to ~5 requests/min and ~20 requests/day — and each user query fires *up to 3* generate calls (intent classification, optional query enhancement, answer). Embeddings count ~1 quota unit *per text* against ~100/min, so indexing the bundled 1,275-page PDF (~3,800 chunks) takes ~40 min of quota pacing. A paid key removes these limits.

### Run locally (without Docker)

1. **Model server** — `cd model-server && pip install -r requirements.txt && python model_server.py` (port 5050)
2. **API** — `cd backend && npm install && npm start` (port 3001)
3. **Frontend** — `cd frontend && npm install && npm start` (port 3000)

Requires MongoDB running locally and a `.env` file in **each** of `backend/` and `model-server/` — see the `.env.example` files and the detailed guide. Indexing goes through the model server's `POST /index` endpoint, so the model server must be running before indexing a document.

**Full setup, env vars, and API reference:** [`docs/backend-and-model-server.md`](docs/backend-and-model-server.md) · **Frontend details:** [`frontend/README.md`](frontend/README.md)

## License

MIT — see [LICENSE](LICENSE).
