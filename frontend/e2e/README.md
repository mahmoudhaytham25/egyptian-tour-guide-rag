# Playwright e2e tests

Runs the production build (`vite preview` on :4173) against a real Express + MongoDB backend. The specs only exercise flows that work without the Flask model server (it needs a real `GEMINI_API_KEY`): registration, login, conversation persistence, and the Knowledge Base document list. The single chat-send assertion stubs `POST /api/query` at the network layer; everything else hits the real backend.

## Prerequisites

- **Backend on :3001 with MongoDB.** `server.js` validates these env vars at startup, so all are required even though the model server is never called:

  ```bash
  cd backend
  JWT_SECRET=e2e-secret \
  MONGODB_URI=mongodb://ragroot:your_mongo_password@localhost:27017/egyptian_history_rag?authSource=admin \
  MODEL_SERVER_URL=http://localhost:5050 \
  INTERNAL_API_TOKEN=e2e-token \
  CORS_ORIGIN=http://localhost:4173 \
  RATE_LIMIT_DISABLED=true \
  node server.js
  ```

  `CORS_ORIGIN` must list the vite preview origin (`http://localhost:4173`) — it is not one of the backend's default dev origins. Run `npx migrate-mongo up` once against a fresh database first.
- **Frontend build.** `vite preview` serves `dist/`, so run `npm run build` before `npm run test:e2e` (the webServer config does not build for you).
- **Playwright browsers.** `npx playwright install chromium` the first time.

## Run

```bash
npm run build                      # produce the dist/ that preview serves
npx playwright install chromium    # first time only
npm run test:e2e
```

## Env overrides

- `E2E_API_URL` — backend base URL (default `http://localhost:3001/api`)
- `PLAYWRIGHT_BASE_URL` — frontend origin (default `http://localhost:4173`)

The suite self-provisions: users are created via `POST /api/auth/signup` with unique `test-<timestamp>-<seq>@e2e.local` addresses (backend requires a valid email format and a password of at least 8 characters).
