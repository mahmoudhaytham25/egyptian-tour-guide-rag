# Frontend — Egyptian Tour Guide RAG

React SPA for the Egyptian Tour Guide chatbot: JWT auth, a streaming chat interface with per-conversation history, and a Knowledge Base page for uploading and indexing the PDFs the RAG pipeline answers from.

**Setup, env vars, and the full-stack picture:** see the [root README](../README.md).

## Stack

React 19 · Vite · React Router v7 · Axios · Vitest + Testing Library · Playwright (e2e). Styling is plain CSS with custom properties — no UI framework.

## Scripts

```bash
npm install
npm run dev        # vite dev server on http://localhost:3000
npm test           # vitest unit/component tests
npm run test:e2e   # playwright e2e (needs `npm run build` + a running backend)
npm run build      # production build to dist/
```

## API URL

`src/services/api.js` reads `VITE_API_URL` at build time, defaulting to `http://localhost:3001/api` for local dev. In the Docker image the bundle is built with `VITE_API_URL=/api` — the container's nginx reverse-proxies `/api/*` to the backend, so the frontend calls the API same-origin.

## Layout

```
src/
├── components/
│   ├── Auth/          Login, Register, RequireAuth, AuthCard
│   ├── chat/          useChat engine + ChatHeader/MessageList/ChatInput/…
│   ├── ChatInterface.jsx   chat shell (sidebar + pane)
│   ├── DocumentUploader.jsx / DocumentManager.jsx
│   └── ThemedBackdrop.jsx   shared page backdrop
├── pages/             Chat (/chat), Documents (/documents — upload + indexing)
├── services/api.js    axios instance, auth token storage, endpoint calls
└── test/helpers.js    shared test utilities
```

The uploader/indexer lives on `/documents` behind `RequireAuth`, reached via the "Knowledge Base" link in the chat header.
