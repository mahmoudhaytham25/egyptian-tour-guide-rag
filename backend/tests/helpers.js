/**
 * Shared test helpers.
 *
 * server.js only connects to MongoDB / binds a port inside its
 * `require.main === module` startup path, and the app itself is built by
 * createApp() in app.js — so tests exercise the real production middleware
 * stack (helmet, CORS, routers, 404 + error handlers) in-process.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || 'http://model-server.test';
process.env.INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || 'test-internal-token';
// The in-memory limiter would otherwise trip across a whole suite of
// in-process requests — disable it here; middleware/rateLimit.js has its
// own unit tests.
process.env.RATE_LIMIT_DISABLED = 'true';

const jwt = require('jsonwebtoken');
const { createApp } = require('../app');

// Not a real ObjectId — works because the auth middleware's User.findById is
// mocked in every suite that exercises protected routes.
const TEST_USER_ID = 'user-1';

function buildApp() {
  return createApp();
}

/** Sign a JWT that the auth middleware will accept. */
function signToken(userId = TEST_USER_ID) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET);
}

function authHeader(userId = TEST_USER_ID) {
  return `Bearer ${signToken(userId)}`;
}

/** Chainable mock for Model.find().sort().limit() queries. */
function sortedLimited(docs) {
  return {
    sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(docs) })
  };
}

/**
 * Point the auth middleware's User.findById().select('email').lean() chain at
 * `user` (or null) — the middleware only hydrates the email field.
 */
function mockAuthUser(user) {
  const User = require('../models/user');
  User.findById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(user)
    })
  });
}

module.exports = { buildApp, signToken, authHeader, sortedLimited, mockAuthUser, TEST_USER_ID };
