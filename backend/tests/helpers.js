/**
 * Shared test helpers.
 *
 * server.js calls connectDB() and app.listen() at require time, so we build a
 * lightweight Express app here that mounts the same routers with the same
 * prefixes — without touching MongoDB or opening a port.
 */
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');

const apiRoutes = require('../routes/api');
const authRoutes = require('../routes/auth');
const chatRoutes = require('../routes/chat');

const TEST_JWT_SECRET = 'test-jwt-secret';
const TEST_USER_ID = 'user-1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api', apiRoutes);

  // Mirror the 404 + error handlers from server.js
  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(500).json({ message: 'Something went wrong!', error: err.message });
  });

  return app;
}

/** Sign a JWT that the auth middleware will accept. */
function signToken(userId = TEST_USER_ID) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET);
}

function authHeader(userId = TEST_USER_ID) {
  return `Bearer ${signToken(userId)}`;
}

module.exports = { buildApp, signToken, authHeader, TEST_JWT_SECRET, TEST_USER_ID };
