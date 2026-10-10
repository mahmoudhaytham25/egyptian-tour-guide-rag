const axios = require('axios');

// Preconfigured client for the internal Flask model server.
//
// The model server is not published outside the compose network and expects
// every call to carry the shared secret in X-Internal-Token. baseURL/token
// come from the environment, which server.js validates before startup.
const modelServer = axios.create({
  baseURL: process.env.MODEL_SERVER_URL,
  // LLM calls can be slow — allow up to 2 minutes, but never hang forever.
  // Callers with longer-running operations (e.g. /index) override per-request.
  timeout: 120000,
  headers: {
    'X-Internal-Token': process.env.INTERNAL_API_TOKEN
  }
});

module.exports = modelServer;
