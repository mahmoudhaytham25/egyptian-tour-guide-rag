# Egyptian Tour Guide — Agentic RAG Chatbot

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
| ![Homepage](Frontend/Home_EgyptianHistory.png) | ![Chat Interface](Frontend/Chat_EgyptianHistory.png) |

## Architecture

```
React Frontend  →  Node.js/Express API  →  Flask Model Server
 (port 3000)        (port 5000)             (port 5050)
                        │                      ├─ Gemini 2.0 Flash (LLM)
                   MongoDB (users,             └─ Sentence Transformers (embeddings)
                   conversations)                        │
                                              Custom .npz vector store ← indexed PDFs
```

- **`Frontend/`** — React app (CoreUI, styled-components): chat interface, document upload/management, auth pages
- **`Backend/backend/`** — Express API: JWT auth, conversation/message CRUD, RAG endpoints (`/api/upload`, `/api/index`, `/api/query`)
- **`Backend/` (Python)** — `model_server.py` Flask services for LLM + embeddings; `rag/` package with classifier, indexer, retriever, generator; `models/` wrappers

## Stack

Python (Flask, Sentence Transformers, PyMuPDF) · Node.js (Express) · React · MongoDB · Google Gemini 2.0 Flash · JWT

## Getting Started

Each component has its own detailed README:

- **Backend (RAG pipeline + API):** [`Backend/README.md`](Backend/README.md) — Python/Node setup, MongoDB, env vars, full API reference
- **Frontend:** [`Frontend/README.md`](Frontend/README.md) — React app setup

Short version: start MongoDB → `python model_server.py` (port 5050) → `npm start` in `Backend/` (port 5000) → `npm start` in `Frontend/` (port 3000).

## License

MIT — see [LICENSE](LICENSE).
