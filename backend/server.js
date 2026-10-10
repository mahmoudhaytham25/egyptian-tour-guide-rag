require('dotenv').config(); // This must be at the top to load environment variables

const fs = require('fs');
const mongoose = require('mongoose');

const { createApp } = require('./app');
const connectDB = require('./config/database');
const { validateEnv } = require('./config/env');
const { DATA_DIR } = require('./config/paths');

const PORT = Number(process.env.PORT) || 3001;

// Startup path — only runs when this file is executed directly
// (`node server.js`), so requiring the module from tests is side-effect free.
async function start() {
  // Fail fast on missing configuration instead of failing at request time.
  validateEnv();

  // Connect to MongoDB (exits the process on failure).
  await connectDB();

  // Create the shared uploads directory if it doesn't exist.
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`- Auth routes: http://localhost:${PORT}/api/auth`);
    console.log(`- Chat routes: http://localhost:${PORT}/api/chat`);
    console.log(`- RAG routes: http://localhost:${PORT}/api`);
  });

  // Keep connections from hanging forever; request timeout stays generous
  // because proxied model-server calls can legitimately take ~2 minutes.
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 65 * 1000;

  // Node running as PID 1 ignores SIGTERM by default — close gracefully so
  // `docker stop` doesn't sit through the SIGKILL timeout.
  const shutdown = (signal) => {
    console.log(`${signal} received — shutting down`);
    server.close(() => {
      mongoose.disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(0));
    });
    // Force-exit if connections don't drain within 10s.
    setTimeout(() => {
      console.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { start };
