// Fail-fast environment validation.
//
// Called from server.js's startup path (not at module import) so the test
// suite can build the app without production env vars set.
const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'MONGODB_URI',
  'MODEL_SERVER_URL',
  'INTERNAL_API_TOKEN'
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`
    );
  }
}

module.exports = { validateEnv };
