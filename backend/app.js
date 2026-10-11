const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const { rateLimit } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errors');

// Allowed browser origins when CORS_ORIGIN is not configured (dev defaults).
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:4173', // vite preview — the local e2e server
  'http://localhost:8080',
  'http://localhost:8081'
];

// Builds the production Express app — same middleware stack and routers
// server.js uses — but without connecting to MongoDB or binding a port,
// so the test suite (tests/helpers.js) can exercise the real app in-process.
function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 'trust proxy' stays off: the browser calls this server directly (no
  // reverse proxy in front), so trusting X-Forwarded-For would let a client
  // spoof req.ip and defeat the rate limiter. If a real proxy is added,
  // trust its subnet explicitly rather than a hop count.
  app.use(helmet());

  // Bearer-token auth — no cookies — so CORS credentials are not needed.
  // CORS_ORIGIN may hold a comma-separated list of extra origins.
  const origins = (process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({ origin: origins }));

  // Bodies are JSON (express.json) or multipart (multer) — no urlencoded.
  app.use(express.json({ limit: '1mb' }));

  // Tight limiter on the credential endpoints (brute-force surface).
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20
  });

  // Mount routes
  app.use('/api/auth', authLimiter, authRoutes); // Authentication routes
  app.use('/api/chat', chatRoutes); // Chat history routes (protected by auth middleware)
  app.use('/api', apiRoutes); // RAG functionality routes

  // Basic route for testing
  app.get('/', (req, res) => {
    res.send('Egyptian History RAG API is running');
  });

  // JSON 404 for unmatched routes, then the terminal error handler so e.g.
  // malformed JSON bodies return JSON instead of Express's HTML error page.
  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
