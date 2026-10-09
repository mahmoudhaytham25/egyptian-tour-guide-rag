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
backend/           Express API (port 5000) — JWT auth, conversations, RAG endpoints
     │                              └─ spawns the indexer for document ingestion
model-server/      Flask model services (port 5050) + RAG pipeline
                   ├─ rag/          classifier, indexer, retriever, generator
                   ├─ models/       Gemini 2.0 Flash LLM + sentence-transformer embeddings
                   ├─ data/         uploaded PDFs (incl. bundled egyptian_history.pdf)
                   └─ times_places/ monument dataset for trip scheduling

MongoDB            users, conversations, chat history
```

## Stack

Python (Flask, Sentence Transformers, PyMuPDF) · Node.js (Express) · React · MongoDB · Google Gemini 2.0 Flash · JWT

## Getting Started

1. **Model server** — `cd model-server && pip install -r requirements.txt && python model_server.py` (port 5050)
2. **API** — `cd backend && npm install && npm start` (port 5000)
3. **Frontend** — `cd frontend && npm install && npm start` (port 3000)

Requires MongoDB running locally and a `.env` file in **each** of `backend/` and `model-server/` — see the `.env.example` files and the detailed guide.

**Full setup, env vars, and API reference:** [`docs/backend-and-model-server.md`](docs/backend-and-model-server.md) · **Frontend details:** [`frontend/README.md`](frontend/README.md)

## License

MIT — see [LICENSE](LICENSE).
